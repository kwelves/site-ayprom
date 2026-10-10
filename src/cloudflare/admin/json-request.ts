interface JsonRequestLimits {
  maxBytes?: number;
  timeoutMs?: number;
  acceptedStatuses?: readonly number[];
}

function unavailable(): Error { return new Error("Admin backend unavailable"); }

// Race both headers and body reads against the same request deadline. A fetch
// timeout alone is insufficient for a backend that stalls after sending headers.
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(unavailable());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener("abort", onAbort); reject(unavailable()); };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

/** Small server-only Auth/RPC responses; limits are injectable only for tests. */
export async function requestAdminJson(
  url: URL, init: RequestInit, fetcher: typeof fetch,
  { maxBytes = 65_536, timeoutMs = 10_000, acceptedStatuses = [] }: JsonRequestLimits = {},
): Promise<{ status: number; ok: boolean; payload: unknown }> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 65_536
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000
    || !["http:", "https:"].includes(url.protocol) || url.username || url.password) throw unavailable();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let completed = false;
  try {
    const pending = fetcher(url, {
      ...init, redirect: "manual", cache: "no-store", signal: controller.signal,
    }).then((received) => {
      if (controller.signal.aborted) {
        void received.body?.cancel().catch(() => {});
        throw unavailable();
      }
      return received;
    });
    response = await abortable(pending, controller.signal);
    if (response.redirected || (response.status >= 300 && response.status < 400)
      || (!response.ok && !acceptedStatuses.includes(response.status)) || !response.body) throw unavailable();
    reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let text = "";
    while (true) {
      const chunk = await abortable(reader.read(), controller.signal);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw unavailable();
      text += decoder.decode(chunk.value, { stream: true });
    }
    const payload: unknown = JSON.parse(text + decoder.decode());
    completed = true;
    return { status: response.status, ok: response.ok, payload };
  } catch {
    throw unavailable();
  } finally {
    clearTimeout(timer);
    if (!completed) {
      controller.abort();
      // Cancellation must not replace a bounded failure with a second wait.
      if (reader) void reader.cancel().catch(() => {});
      else if (response?.body) void response.body.cancel().catch(() => {});
    }
    reader?.releaseLock();
  }
}
