import { createHash } from "node:crypto";
import type { RouteManifestEntry } from "../route-manifest";
import { errorCodeOf, ProducerError } from "./errors";
import type { CrawlFailure, CrawlReportEntry, CrawlResult, CrawlSink, ProducerLimits } from "./types";

type DocumentEntry = Extract<RouteManifestEntry, { class: "static" | "query" }>;

export interface CrawlOptions {
  baseUrl: string;
  entries: RouteManifestEntry[];
  limits: Pick<ProducerLimits, "concurrency" | "requestTimeoutMs" | "maxBodyBytes" | "notFoundProbePath">;
  sink: CrawlSink;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

interface Expectation {
  requestPath: string;
  status: number;
  mediaTypes: readonly string[];
}

/**
 * Fetches every static/query manifest entry from the loopback server with
 * bounded concurrency and hands the body to the sink. Redirect and invalid
 * entries are not requested. Per-route problems become sanitized failures;
 * an abort of the shared signal rejects with `crawl_failed`/`aborted` and
 * carries the results gathered so far.
 */
export async function crawlRoutes(options: CrawlOptions): Promise<CrawlResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const documents = options.entries.filter(
    (entry): entry is DocumentEntry => entry.class === "static" || entry.class === "query",
  );
  const entries: CrawlReportEntry[] = [];
  const failures: CrawlFailure[] = [];
  let next = 0;

  const worker = async () => {
    while (next < documents.length) {
      if (options.signal?.aborted) throw aborted();
      const document = documents[next];
      next += 1;
      const outcome = await fetchDocument(document, options, fetchImpl);
      if ("failure" in outcome) {
        failures.push(outcome.failure);
        continue;
      }
      await options.sink.write(document.outputFile, outcome.bytes);
      entries.push({
        path: document.path,
        family: document.family,
        class: document.class,
        outputFile: document.outputFile,
        status: outcome.status,
        contentType: outcome.contentType,
        bytes: outcome.bytes.byteLength,
        sha256: createHash("sha256").update(outcome.bytes).digest("hex"),
      });
    }
  };

  const workers = Array.from({ length: Math.min(options.limits.concurrency, documents.length) }, worker);
  const settled = await Promise.allSettled(workers);
  const rejected = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
  const result: CrawlResult = { entries: sortByPath(entries), failures: sortByPath(failures) };
  if (rejected) {
    const error = rejected.reason as unknown;
    if (error instanceof ProducerError && error.reason === "aborted") {
      throw new ProducerError("crawl_failed", "aborted", { partial: result });
    }
    throw error;
  }
  return result;

  function aborted() {
    return new ProducerError("crawl_failed", "aborted");
  }
}

async function fetchDocument(
  document: DocumentEntry,
  options: CrawlOptions,
  fetchImpl: typeof fetch,
): Promise<{ status: number; contentType: string; bytes: Uint8Array } | { failure: CrawlFailure }> {
  const expectation = expectationFor(document, options.limits.notFoundProbePath);
  const failure = (reason: CrawlFailure["reason"], extra: Partial<CrawlFailure> = {}): { failure: CrawlFailure } => ({
    failure: { path: document.path, outputFile: document.outputFile, reason, ...extra },
  });
  const signals = [AbortSignal.timeout(options.limits.requestTimeoutMs)];
  if (options.signal) signals.push(options.signal);
  const signal = AbortSignal.any(signals);

  let response: Response;
  try {
    response = await fetchImpl(`${options.baseUrl}${expectation.requestPath}`, {
      redirect: "manual",
      signal,
      headers: { accept: "*/*" },
    });
  } catch (error) {
    if (options.signal?.aborted) throw new ProducerError("crawl_failed", "aborted");
    if (isTimeout(error)) return failure("request_timeout");
    return failure("request_failed", { errorCode: errorCodeOf(error) });
  }

  const status = response.status;
  if (status >= 300 && status < 400) {
    await response.body?.cancel().catch(() => undefined);
    return failure("unexpected_redirect", { status });
  }
  if (status !== expectation.status) {
    await response.body?.cancel().catch(() => undefined);
    return failure("unexpected_status", { status });
  }
  const contentType = mediaTypeOf(response.headers.get("content-type"));
  if (!expectation.mediaTypes.includes(contentType)) {
    await response.body?.cancel().catch(() => undefined);
    return failure("unexpected_content_type", { status });
  }

  try {
    const bytes = await readBodyWithLimit(response, options.limits.maxBodyBytes);
    if (bytes === null) return failure("body_limit_exceeded");
    return { status, contentType, bytes };
  } catch (error) {
    if (options.signal?.aborted) throw new ProducerError("crawl_failed", "aborted");
    if (isTimeout(error)) return failure("request_timeout");
    return failure("request_failed", { errorCode: errorCodeOf(error) });
  }
}

async function readBodyWithLimit(response: Response, maxBodyBytes: number): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array(0);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBodyBytes) {
    await response.body.cancel().catch(() => undefined);
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBodyBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function expectationFor(document: DocumentEntry, notFoundProbePath: string): Expectation {
  switch (document.family) {
    case "robots":
      return { requestPath: document.path, status: 200, mediaTypes: ["text/plain"] };
    case "sitemap":
      return { requestPath: document.path, status: 200, mediaTypes: ["application/xml", "text/xml"] };
    case "not-found":
      return { requestPath: notFoundProbePath, status: 404, mediaTypes: ["text/html"] };
    default:
      return { requestPath: document.path, status: 200, mediaTypes: ["text/html"] };
  }
}

function mediaTypeOf(header: string | null): string {
  return (header ?? "").split(";", 1)[0].trim().toLowerCase();
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || errorCodeOf(error) === "UND_ERR_HEADERS_TIMEOUT");
}

function sortByPath<T extends { path: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}
