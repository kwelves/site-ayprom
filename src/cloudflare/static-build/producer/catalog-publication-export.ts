// Node-only parent builder. A pinned capability is sent to PostgREST, never to
// the Next child, public artifacts, URLs, or returned export.
import { Buffer } from "node:buffer";
import {
  CATALOG_DOCUMENT_KINDS,
  catalogDocumentKey,
  type CatalogDocumentKind,
} from "../../../lib/catalog-publication-reader";
import type { CatalogCaptureReceipt } from "./catalog-publication-capture";
import { resolveWorkersBuildBinding, type WorkersBuildBindingInput } from "./workers-build-config";

const PAGE_SIZE = 20;
const MAX_DOCUMENTS = 20_000;
const MAX_DOCUMENT_BYTES = 1_048_576;
const MAX_TOTAL_BYTES = 536_870_912;
const MAX_PAGE_BYTES = 25 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;

type Document = Record<string, unknown>;
export interface CatalogPublicationExportSource {
  list(kind: CatalogDocumentKind, releaseId: string, capability: string, from: number, to: number):
    Promise<{ rows: unknown; total: unknown }>;
}
export interface CatalogPublicationExport {
  format: 1;
  releaseId: string;
  revision: number;
  sha256: string;
  documentCount: number;
  documents: Record<CatalogDocumentKind, Document[]>;
}

export class CatalogPublicationExportError extends Error {
  constructor() {
    super("Catalog export unavailable");
    this.name = "CatalogPublicationExportError";
  }
}

export async function exportCatalogPublication(input: {
  receipt: CatalogCaptureReceipt;
  capability: string;
  source: CatalogPublicationExportSource;
}): Promise<CatalogPublicationExport> {
  const { receipt, capability, source } = input;
  if (!receipt || !UUID.test(receipt.releaseId) || !Number.isSafeInteger(receipt.revision)
    || receipt.revision < 0 || !HASH.test(receipt.sha256)
    || !Number.isSafeInteger(receipt.documentCount) || receipt.documentCount < 0
    || receipt.documentCount > MAX_DOCUMENTS || typeof capability !== "string"
    || capability.length < 32 || capability.length > 256 || typeof source?.list !== "function") {
    throw new CatalogPublicationExportError();
  }
  const documents = {} as Record<CatalogDocumentKind, Document[]>;
  let documentCount = 0;
  let totalBytes = 0;
  try {
    for (const kind of CATALOG_DOCUMENT_KINDS) {
      const collected: Document[] = [];
      const keys = new Set<string>();
      let expectedTotal: number | null = null;
      do {
        const from = collected.length;
        const page = await source.list(kind, receipt.releaseId, capability, from, from + PAGE_SIZE - 1);
        if (!page || !Number.isSafeInteger(page.total) || (page.total as number) < 0
          || (page.total as number) > MAX_DOCUMENTS
          || (expectedTotal !== null && expectedTotal !== page.total)
          || !Array.isArray(page.rows) || page.rows.length > PAGE_SIZE
          || page.rows.length !== Math.min(PAGE_SIZE, (page.total as number) - from)) {
          throw new CatalogPublicationExportError();
        }
        expectedTotal = page.total as number;
        for (const item of page.rows) {
          if (!item || typeof item !== "object" || Array.isArray(item)) throw new CatalogPublicationExportError();
          const row = item as Document;
          const key = catalogDocumentKey(kind, row);
          if (!key || key.length > 256 || keys.has(key)) throw new CatalogPublicationExportError();
          keys.add(key);
          const text = JSON.stringify(row);
          if (!text || text.includes(capability)) throw new CatalogPublicationExportError();
          const bytes = Buffer.byteLength(text);
          if (bytes > MAX_DOCUMENT_BYTES) throw new CatalogPublicationExportError();
          totalBytes += bytes;
          if (totalBytes > MAX_TOTAL_BYTES) throw new CatalogPublicationExportError();
          collected.push(row);
          documentCount += 1;
          if (documentCount > MAX_DOCUMENTS || documentCount > receipt.documentCount) throw new CatalogPublicationExportError();
        }
      } while (collected.length < (expectedTotal ?? 0));
      documents[kind] = collected;
    }
    if (documentCount !== receipt.documentCount) throw new CatalogPublicationExportError();
    return { format: 1, releaseId: receipt.releaseId, revision: receipt.revision,
      sha256: receipt.sha256, documentCount, documents };
  } catch {
    throw new CatalogPublicationExportError();
  }
}

function parseExactRange(value: string | null, from: number, rows: number): number {
  if (rows === 0 && from === 0 && value === "*/0") return 0;
  const match = /^(\d+)-(\d+)\/(\d+)$/.exec(value ?? "");
  if (!match) throw new CatalogPublicationExportError();
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (![start, end, total].every(Number.isSafeInteger) || start !== from
    || end !== start + rows - 1 || end >= total) throw new CatalogPublicationExportError();
  return total;
}

function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new CatalogPublicationExportError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new CatalogPublicationExportError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

async function boundedResponseJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new CatalogPublicationExportError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let complete = false;
  try {
    while (true) {
      const part = await abortable(reader.read(), signal);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_PAGE_BYTES) throw new CatalogPublicationExportError();
      chunks.push(part.value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    complete = true;
    return value;
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createCatalogPublicationExportSource(
  bindings: WorkersBuildBindingInput,
  fetcher: typeof fetch = fetch,
): CatalogPublicationExportSource {
  const binding = resolveWorkersBuildBinding(bindings);
  if (!binding.ok) throw new CatalogPublicationExportError();
  return {
    async list(kind, releaseId, capability, from, to) {
      if (!(CATALOG_DOCUMENT_KINDS as readonly string[]).includes(kind) || !UUID.test(releaseId)
        || typeof capability !== "string" || capability.length < 32 || capability.length > 256
        || !Number.isSafeInteger(from) || from < 0 || !Number.isSafeInteger(to)
        || to < from || to - from + 1 > PAGE_SIZE) throw new CatalogPublicationExportError();
      const url = new URL("/rest/v1/rpc/list_catalog_publication_documents", binding.url);
      // PostgREST ignores Range headers on POST RPCs.
      url.searchParams.set("offset", String(from));
      url.searchParams.set("limit", String(to - from + 1));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await abortable(fetcher(url, {
          method: "POST", redirect: "manual", cache: "no-store", signal: controller.signal,
          headers: { apikey: binding.key, "content-type": "application/json", prefer: "count=exact" },
          body: JSON.stringify({ kind, publication_id: releaseId, publication_capability: capability }),
        }), controller.signal);
        if (response.redirected || !response.ok || response.status >= 300) throw new CatalogPublicationExportError();
        const rows = await boundedResponseJson(response, controller.signal);
        if (!Array.isArray(rows) || rows.length > PAGE_SIZE) throw new CatalogPublicationExportError();
        const total = parseExactRange(response.headers.get("content-range"), from, rows.length);
        if (rows.length !== Math.min(to - from + 1, total - from)) throw new CatalogPublicationExportError();
        return { rows, total };
      } catch { throw new CatalogPublicationExportError(); }
      finally { clearTimeout(timer); controller.abort(); }
    },
  };
}
