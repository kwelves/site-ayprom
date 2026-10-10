import { afterEach, describe, expect, it, vi } from "vitest";
import { createCatalogSearchRequest } from "@/lib/catalog-search-contract";
import { createPublicCatalogSearchRpc } from "@/cloudflare/supabase-catalog-search";
import workerEntry from "@/cloudflare/worker";

const releaseId = "20000000-0000-4000-8000-000000000001";
const capability = "local-workerd-publication-capability-fixture-2026";
const base = { SUPABASE_URL: "https://catalog.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test" };

afterEach(() => vi.unstubAllGlobals());

describe("Worker search pinned to a catalog release", () => {
  it("adds release identity only to the RPC body and preserves the ProductPage data source", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("[]", {
      status: 200, headers: { "content-type": "application/json", "content-range": "*/0" },
    }));
    const rpc = createPublicCatalogSearchRpc({ ...base,
      PUBLICATION_ID: releaseId, PUBLICATION_CAPABILITY: capability }, fetcher);

    await expect(rpc(createCatalogSearchRequest({ query: "pump", categorySlug: "pto" })))
      .resolves.toEqual({ rows: [], count: 0 });
    const [url, init] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://catalog.supabase.co/rest/v1/rpc/search_catalog_products?offset=0&limit=24");
    expect(JSON.parse(String(init.body))).toMatchObject({ search_query: "pump",
      category_filter: "pto", publication_id: releaseId, publication_capability: capability });
    expect(url.toString()).not.toContain(capability);
    expect(JSON.stringify(init.headers)).not.toContain(capability);
  });

  it.each([
    [undefined, undefined],
    [releaseId, undefined],
    [releaseId, "short"],
    ["not-a-uuid", capability],
  ])("denies missing or malformed release binding before any Supabase request", async (id, cap) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("[]", {
      status: 200, headers: { "content-type": "application/json", "content-range": "*/0" },
    }));
    vi.stubGlobal("fetch", fetcher);
    const response = await workerEntry.fetch(new Request("https://worker.test/api/catalog/search?q=pump"),
      { ...base, PUBLICATION_ID: id, PUBLICATION_CAPABILITY: cap } as Env);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: {
      code: "catalog_search_failed", message: "Catalog search is temporarily unavailable",
    } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(response.headers)).not.toContain(capability);
  });

  it("sends all filters and release scope through the real Worker entry", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("[]", {
      status: 200, headers: { "content-type": "application/json", "content-range": "*/0" },
    }));
    vi.stubGlobal("fetch", fetcher);
    const response = await workerEntry.fetch(new Request(
      "https://worker.test/api/catalog/search?q=pump&page=2&category=pto&subcategory=shaft&brand=kamaz&vehicleType=truck",
    ), { ...base, PUBLICATION_ID: releaseId, PUBLICATION_CAPABILITY: capability } as Env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [], total: 0, page: 2,
      pageSize: 24, totalPages: 1 });
    const [url, init] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get("offset")).toBe("24");
    expect(JSON.parse(String(init.body))).toEqual({ search_query: "pump", category_filter: "pto",
      subcategory_filter: "shaft", brand_filter: "kamaz", vehicle_type_filter: "truck",
      publication_id: releaseId, publication_capability: capability });
    expect(JSON.stringify(init.headers)).not.toContain(capability);
    expect(JSON.stringify(init.headers)).not.toContain("Authorization");
  });

  it.each(["sb_secret_local_test", ["eyJhbGciOiJIUzI1NiJ9",
    Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url"), "signature"].join(".")])(
    "rejects a private Supabase key before fetch", async (key) => {
      const fetcher = vi.fn();
      const rpc = createPublicCatalogSearchRpc({ ...base, SUPABASE_PUBLISHABLE_KEY: key,
        PUBLICATION_ID: releaseId, PUBLICATION_CAPABILITY: capability }, fetcher);
      await expect(rpc(createCatalogSearchRequest())).rejects.toThrow("configuration unavailable");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("does not echo the capability when the pinned release is denied by Supabase", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(`denied ${capability}`, { status: 500 }));
    vi.stubGlobal("fetch", fetcher);
    const response = await workerEntry.fetch(new Request("https://worker.test/api/catalog/search"),
      { ...base, PUBLICATION_ID: releaseId, PUBLICATION_CAPABILITY: capability } as Env);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(capability);
  });
});
