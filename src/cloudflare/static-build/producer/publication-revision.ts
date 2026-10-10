// Node build-side helper. Never imported by the Worker or browser bundle.
// It deliberately accepts only a Supabase public key: static publication must
// not require service-role access merely to read the catalog revision.

const MAX_RESPONSE_BYTES = 64;

interface RevisionSource {
  url: string;
  key: string;
  fetchImpl?: typeof fetch;
}

function unavailable(): Error {
  return new Error("publication_revision_unavailable");
}

function publicKeyAllowed(key: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  if (key.split(".").length !== 3) return false;
  try {
    const payload: unknown = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
    return typeof payload === "object" && payload !== null && "role" in payload && payload.role === "anon";
  } catch {
    return false;
  }
}

function rpcUrl(input: RevisionSource): URL {
  let parsed: URL;
  try { parsed = new URL(input.url); }
  catch { throw unavailable(); }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if ((parsed.protocol !== "https:" && !(loopback && parsed.protocol === "http:"))
    || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash
    || !publicKeyAllowed(input.key)) throw unavailable();
  return new URL("/rest/v1/rpc/get_content_revision", parsed);
}

/** Read the non-secret publication fence via the anon/publishable Data API. */
export async function readPublicContentRevision(input: RevisionSource): Promise<number> {
  const endpoint = rpcUrl(input);
  try {
    const response = await (input.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      headers: { apikey: input.key },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 200 || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw unavailable();
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (declaredLength > MAX_RESPONSE_BYTES) throw unavailable();
    const reader = response.body?.getReader();
    if (!reader) throw unavailable();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_RESPONSE_BYTES) throw unavailable();
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!Number.isSafeInteger(value) || (value as number) < 0) throw unavailable();
    return value as number;
  } catch {
    throw unavailable();
  }
}

/**
 * Fence build/staging work only. The callback must not publish or switch the
 * live site: that later action needs its own version check at promotion time.
 */
export async function runRevisionFencedWork<T>(
  readCurrent: () => Promise<number>,
  buildStaging: (revision: number) => Promise<T>,
): Promise<{ revision: number; value: T }> {
  const read = async () => {
    try {
      const value = await readCurrent();
      if (!Number.isSafeInteger(value) || value < 0) throw unavailable();
      return value;
    } catch {
      throw unavailable();
    }
  };
  const revision = await read();
  const value = await buildStaging(revision);
  if (await read() !== revision) throw new Error("publication_revision_changed");
  return { revision, value };
}
