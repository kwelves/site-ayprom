// Calls from the admin Worker to the database (PostgREST, `/rest/v1/`) must never hang: on staging a few
// requests stayed open for 45 s until the browser gave up. A read is cut after READ_TIMEOUT_MS and tried once
// more (reads change nothing, so repeating them is safe). A write is only cut after the longer WRITE_TIMEOUT_MS
// and never repeated, because it may already have taken effect. Everything else (file storage, other hosts) is
// passed through untouched.
type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface FetchGuardOptions {
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
}

export const READ_TIMEOUT_MS = 8_000;
export const WRITE_TIMEOUT_MS = 25_000;

function requestOf(input: RequestInfo | URL): { url: string; method: string } {
  if (typeof input === "string") return { url: input, method: "GET" };
  if (input instanceof URL) return { url: input.href, method: "GET" };
  return { url: input.url, method: input.method };
}

export function createGuardedFetch(original: FetchFn, options: FetchGuardOptions = {}): FetchFn {
  const readTimeout = options.readTimeoutMs ?? READ_TIMEOUT_MS;
  const writeTimeout = options.writeTimeoutMs ?? WRITE_TIMEOUT_MS;

  async function attempt(input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const forward = () => controller.abort(caller?.reason);
    if (caller?.aborted) forward();
    else caller?.addEventListener("abort", forward, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException("database request timed out", "TimeoutError")), timeoutMs);
    try {
      return await original(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener("abort", forward);
    }
  }

  return async (input, init) => {
    const { url, method: requested } = requestOf(input);
    const method = (init?.method ?? requested).toUpperCase();
    if (!url.includes("/rest/v1/")) return original(input, init);
    if (method !== "GET" && method !== "HEAD") return attempt(input, init, writeTimeout);
    try {
      return await attempt(input, init, readTimeout);
    } catch (error) {
      const callerStopped = (init?.signal ?? (input instanceof Request ? input.signal : undefined))?.aborted;
      if (callerStopped) throw error;
      return attempt(input, init, readTimeout);
    }
  };
}
