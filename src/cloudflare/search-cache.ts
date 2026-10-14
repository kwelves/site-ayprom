// Cache for the Worker's catalog search. A release is immutable, so the answer to one query inside one
// release never changes: the key is (release id + normalised query). A new release has a new id and
// therefore never sees old entries, which keeps pages and search on one edition. The browser still gets the
// origin's own headers (no-store). Two layers, fastest first:
//   1. memory of the running Worker (works everywhere, including workers.dev, no network at all);
//   2. the edge Cache API (shared by the data centre; absent on workers.dev).
export interface EdgeCacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface MemoryEntry { body: string; headers: [string, string][] }
export type SearchMemory = Map<string, MemoryEntry>;

const RELEASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_QUERY_LENGTH = 400;
const EDGE_TTL_SECONDS = 86_400;
const DEFAULT_MEMORY_LIMIT = 300;
const MAX_MEMORY_BODY_BYTES = 256 * 1024;

export async function cachedCatalogSearch(request: Request, deps: {
  cache?: EdgeCacheLike;
  memory?: SearchMemory;
  memoryLimit?: number;
  publicationId: string | undefined;
  waitUntil(promise: Promise<unknown>): void;
  handle(request: Request): Promise<Response>;
}): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/api/catalog/search"
    || typeof deps.publicationId !== "string" || !RELEASE_ID.test(deps.publicationId)
    || url.search.length > MAX_QUERY_LENGTH) return deps.handle(request);

  const params = [...url.searchParams.entries()].sort(([ak, av], [bk, bv]) => (ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk)));
  const normalised = new URLSearchParams(params).toString();
  const memoryKey = `${deps.publicationId}?${normalised}`;
  const edgeKey = new Request(`https://search-cache.invalid/v1/${deps.publicationId}?${normalised}`);
  const remember = (body: string, headers: Headers) => {
    if (!deps.memory || body.length > MAX_MEMORY_BODY_BYTES) return;
    deps.memory.delete(memoryKey);
    deps.memory.set(memoryKey, { body, headers: [...headers.entries()] });
    const limit = deps.memoryLimit ?? DEFAULT_MEMORY_LIMIT;
    while (deps.memory.size > limit) {
      const oldest = deps.memory.keys().next().value;
      if (oldest === undefined) break;
      deps.memory.delete(oldest);
    }
  };

  const remembered = deps.memory?.get(memoryKey);
  if (remembered) {
    // Refresh recency so frequently asked queries survive eviction.
    deps.memory!.delete(memoryKey);
    deps.memory!.set(memoryKey, remembered);
    return withHeader(new Response(remembered.body, { status: 200, headers: remembered.headers }),
      { "cache-control": "no-store", "x-search-cache": "memory" });
  }

  if (deps.cache) {
    try {
      const hit = await deps.cache.match(edgeKey);
      if (hit) {
        const body = await hit.clone().text();
        const answer = withHeader(new Response(body, { status: hit.status, headers: hit.headers }),
          { "cache-control": "no-store", "x-search-cache": "hit" });
        remember(body, answer.headers);
        return answer;
      }
    } catch { /* a broken cache must never break search */ }
  }

  const response = await deps.handle(request);
  if (response.status !== 200) return withHeader(response, { "x-search-cache": "miss" });
  let body: string;
  try { body = await response.clone().text(); } catch { return withHeader(response, { "x-search-cache": "miss" }); }
  const answer = withHeader(new Response(body, { status: 200, headers: response.headers }), { "x-search-cache": "miss" });
  remember(body, response.headers);
  if (deps.cache) {
    try {
      const stored = withHeader(new Response(body, { status: 200, headers: response.headers }), { "cache-control": `public, max-age=${EDGE_TTL_SECONDS}` });
      deps.waitUntil(deps.cache.put(edgeKey, stored).catch(() => undefined));
    } catch { /* ignore */ }
  }
  return answer;
}

function withHeader(response: Response, headers: Record<string, string>): Response {
  const next = new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
  for (const [name, value] of Object.entries(headers)) next.headers.set(name, value);
  return next;
}
