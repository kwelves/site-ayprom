import type { StaticBuildIssue } from "../validation";
import type { CrawlResult, ProducerFailureCode } from "./types";

// Failure carrier for the producer. The message is intentionally the stable
// code/reason pair: response bodies, environment values, child output and
// Location headers never travel through it.
export class ProducerError extends Error {
  readonly code: ProducerFailureCode;
  readonly reason: string;
  readonly issues: StaticBuildIssue[];
  readonly exitCode: number | null;
  /** Crawl results gathered before an abort, so the report can still be written. */
  readonly partial: CrawlResult | null;
  /** PID of a child that was spawned before the failure, so callers can verify it is gone. */
  childPid: number | null = null;

  constructor(
    code: ProducerFailureCode,
    reason: string,
    options: { issues?: StaticBuildIssue[]; exitCode?: number | null; partial?: CrawlResult } = {},
  ) {
    super(`${code}: ${reason}`);
    this.name = "ProducerError";
    this.code = code;
    this.reason = reason;
    this.issues = options.issues ?? [];
    this.exitCode = options.exitCode ?? null;
    this.partial = options.partial ?? null;
  }
}

export function isProducerError(error: unknown): error is ProducerError {
  return error instanceof ProducerError;
}

/** Extracts a safe error code (ECONNREFUSED, ENOENT, ...) from a thrown value. */
export function errorCodeOf(error: unknown): string {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_]+$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return "UNKNOWN";
}
