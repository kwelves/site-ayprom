import { describe, expect, it, vi } from "vitest";
import { cachedCatalogSearch, type EdgeCacheLike } from "@/cloudflare/search-cache";

const RELEASE = "10000000-0000-4000-8000-000000000001";
const OTHER_RELEASE = "10000000-0000-4000-8000-000000000002";

function fakeCache() {
  const store = new Map<string, Response>();
  const cache: EdgeCacheLike = {
    async match(request) { return store.get(request.url)?.clone(); },
    async put(request, response) { store.set(request.url, response.clone()); },
  };
  return { store, cache };
}
const security = { "content-security-policy": "default-src 'none'", "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const okHandler = (body = '{"items":[1]}') => vi.fn(async () => new Response(body, { status: 200, headers: security }));
const request = (query: string, method = "GET", path = "/api/catalog/search") => new Request(`https://site.test${path}${query}`, { method });
const run = (r: Request, over: Partial<Parameters<typeof cachedCatalogSearch>[1]> & { handle: (r: Request) => Promise<Response> }) => {
  const waits: Promise<unknown>[] = [];
  const { cache } = fakeCache();
  return cachedCatalogSearch(r, { cache, publicationId: RELEASE, waitUntil: (p) => { waits.push(p); }, ...over })
    .then(async (response) => { await Promise.all(waits); return response; });
};

describe("edge cache for immutable catalog search", () => {
  it("serves the second identical request from the cache without calling the origin again", async () => {
    const { cache } = fakeCache();
    const handle = okHandler();
    const waits: Promise<unknown>[] = [];
    const deps = { cache, publicationId: RELEASE, waitUntil: (p: Promise<unknown>) => { waits.push(p); }, handle };
    const first = await cachedCatalogSearch(request("?q=pump"), deps);
    await Promise.all(waits);
    const second = await cachedCatalogSearch(request("?q=pump"), deps);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(first.headers.get("x-search-cache")).toBe("miss");
    expect(second.headers.get("x-search-cache")).toBe("hit");
    expect(await second.text()).toBe('{"items":[1]}');
  });

  it("keeps the browser-facing headers of the origin answer (no-store, security headers)", async () => {
    const { cache } = fakeCache();
    const waits: Promise<unknown>[] = [];
    const deps = { cache, publicationId: RELEASE, waitUntil: (p: Promise<unknown>) => { waits.push(p); }, handle: okHandler() };
    await cachedCatalogSearch(request("?q=a"), deps);
    await Promise.all(waits);
    for (const response of [await cachedCatalogSearch(request("?q=a"), deps)]) {
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-security-policy")).toBe("default-src 'none'");
      expect(response.headers.get("content-type")).toContain("application/json");
    }
  });

  it("treats the same parameters in another order as one query, and different parameters as different", async () => {
    const { cache } = fakeCache();
    const handle = okHandler();
    const waits: Promise<unknown>[] = [];
    const deps = { cache, publicationId: RELEASE, waitUntil: (p: Promise<unknown>) => { waits.push(p); }, handle };
    await cachedCatalogSearch(request("?q=pump&page=2"), deps); await Promise.all(waits);
    await cachedCatalogSearch(request("?page=2&q=pump"), deps); await Promise.all(waits);
    await cachedCatalogSearch(request("?q=pump&page=3"), deps); await Promise.all(waits);
    expect(handle).toHaveBeenCalledTimes(2);
  });

  it("never shares answers between releases", async () => {
    const { cache } = fakeCache();
    const handle = okHandler();
    const waits: Promise<unknown>[] = [];
    const wait = (p: Promise<unknown>) => { waits.push(p); };
    await cachedCatalogSearch(request("?q=pump"), { cache, publicationId: RELEASE, waitUntil: wait, handle }); await Promise.all(waits);
    await cachedCatalogSearch(request("?q=pump"), { cache, publicationId: OTHER_RELEASE, waitUntil: wait, handle }); await Promise.all(waits);
    expect(handle).toHaveBeenCalledTimes(2);
  });

  it.each([400, 404, 502])("does not cache a %s answer", async (status) => {
    const { cache, store } = fakeCache();
    const handle = vi.fn(async () => new Response("{}", { status, headers: security }));
    const waits: Promise<unknown>[] = [];
    const deps = { cache, publicationId: RELEASE, waitUntil: (p: Promise<unknown>) => { waits.push(p); }, handle };
    const answer = await cachedCatalogSearch(request("?q=x"), deps);
    await Promise.all(waits);
    expect(answer.status).toBe(status);
    expect(store.size).toBe(0);
  });

  it("leaves other paths, other methods and a missing release id completely alone", async () => {
    const touched = vi.fn();
    const cache: EdgeCacheLike = { match: async () => { touched(); return undefined; }, put: async () => { touched(); } };
    const handle = okHandler();
    const wait = () => undefined;
    await cachedCatalogSearch(request("", "GET", "/api/health"), { cache, publicationId: RELEASE, waitUntil: wait, handle });
    await cachedCatalogSearch(request("?q=a", "POST"), { cache, publicationId: RELEASE, waitUntil: wait, handle });
    await cachedCatalogSearch(request("?q=a"), { cache, publicationId: "not-a-uuid", waitUntil: wait, handle });
    await cachedCatalogSearch(request("?q=a"), { cache, publicationId: undefined, waitUntil: wait, handle });
    expect(handle).toHaveBeenCalledTimes(4);
    expect(touched).not.toHaveBeenCalled();
  });

  it("answers from the origin when the cache itself fails", async () => {
    const cache: EdgeCacheLike = { match: async () => { throw new Error("cache down"); }, put: async () => { throw new Error("cache down"); } };
    const handle = okHandler();
    const answer = await run(request("?q=a"), { cache, handle });
    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe('{"items":[1]}');
  });

  // workers.dev has no Cache API at all, and every first request per data centre misses it: an in-memory
  // layer inside the running Worker answers repeated queries with no network and no cache API.
  describe("in-memory layer", () => {
    const waits: Promise<unknown>[] = [];
    const base = (over: Record<string, unknown>) => ({ publicationId: RELEASE, waitUntil: (p: Promise<unknown>) => { waits.push(p); }, ...over });

    it("answers a repeated query from memory even with no edge cache available", async () => {
      const memory = new Map();
      const handle = okHandler();
      const deps = base({ cache: undefined, memory, handle }) as Parameters<typeof cachedCatalogSearch>[1];
      const first = await cachedCatalogSearch(request("?q=pump"), deps);
      const second = await cachedCatalogSearch(request("?q=pump"), deps);
      expect(handle).toHaveBeenCalledTimes(1);
      expect(first.headers.get("x-search-cache")).toBe("miss");
      expect(second.headers.get("x-search-cache")).toBe("memory");
      expect(second.headers.get("cache-control")).toBe("no-store");
      expect(await second.text()).toBe('{"items":[1]}');
      expect(await (await cachedCatalogSearch(request("?q=pump"), deps)).text()).toBe('{"items":[1]}');
    });

    it("keeps releases apart, does not store failures, and forgets the oldest entries beyond its limit", async () => {
      const memory = new Map();
      const handle = okHandler();
      const failing = vi.fn(async () => new Response("{}", { status: 502, headers: security }));
      await cachedCatalogSearch(request("?q=a"), base({ cache: undefined, memory, handle: failing }) as Parameters<typeof cachedCatalogSearch>[1]);
      expect(memory.size).toBe(0);
      const deps = (publicationId: string) => base({ cache: undefined, memory, memoryLimit: 2, handle, publicationId }) as Parameters<typeof cachedCatalogSearch>[1];
      await cachedCatalogSearch(request("?q=a"), deps(RELEASE));
      await cachedCatalogSearch(request("?q=a"), deps(OTHER_RELEASE));
      expect(handle).toHaveBeenCalledTimes(2);
      await cachedCatalogSearch(request("?q=b"), deps(RELEASE));
      expect(memory.size).toBe(2);
      await cachedCatalogSearch(request("?q=a"), deps(RELEASE));
      expect(handle).toHaveBeenCalledTimes(4);
    });

    it("fills memory from an edge-cache hit, so the next request skips even the edge cache", async () => {
      const { cache } = fakeCache();
      const memory = new Map();
      const handle = okHandler();
      const deps = base({ cache, memory, handle }) as Parameters<typeof cachedCatalogSearch>[1];
      await cachedCatalogSearch(request("?q=z"), deps);
      await Promise.all(waits);
      memory.clear();
      const viaEdge = await cachedCatalogSearch(request("?q=z"), deps);
      expect(viaEdge.headers.get("x-search-cache")).toBe("hit");
      const viaMemory = await cachedCatalogSearch(request("?q=z"), deps);
      expect(viaMemory.headers.get("x-search-cache")).toBe("memory");
      expect(handle).toHaveBeenCalledTimes(1);
    });
  });
});
