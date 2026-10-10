import { describe, expect, it, vi } from "vitest";
import { loadLocalCatalogSnapshot } from "@/cloudflare/static-build/producer/local-snapshot";

const url = "http://127.0.0.1:54321";
const key = "sb_publishable_local_test";

function rowsFor(table: string): unknown[] {
  switch (table) {
    case "categories": return [{ slug: "pumps", name: "Pumps", type: "subcategory" }];
    case "subcategories": return [{ slug: "gear", name: "Gear", category_slug: "pumps" }];
    case "brands": return [{ slug: "man", name: "MAN" }];
    case "vehicle_types": return [{ slug: "truck", name: "Truck" }];
    case "category_brands": return [];
    case "products": return [{
      slug: "pump-one", name: "Pump One", category_slug: "pumps", short_description: "Hydraulic pump",
      article: "A-1", updated_at: "2026-09-24T00:00:00.000Z", subcategories: { slug: "gear" },
      product_images: [{ url: "https://media.ayprom-gidravlika.kg/pump.jpg", order: 1, scale: null }],
      product_brands: [{ brand_slug: "man" }], product_vehicle_types: [{ vehicle_type_slug: "truck" }],
    }];
    default: throw new Error(`unexpected table ${table}`);
  }
}

describe("local catalog snapshot", () => {
  it("uses only local public GETs and produces a validated deterministic snapshot", async () => {
    const requests: { method: string; url: URL; key: string | null; prefer: string | null }[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const requestUrl = new URL(String(input));
      const rows = rowsFor(requestUrl.pathname.split("/").at(-1)!);
      requests.push({ method: init?.method ?? "GET", url: requestUrl, key: new Headers(init?.headers).get("apikey"), prefer: new Headers(init?.headers).get("prefer") });
      return new Response(JSON.stringify(rows), {
        status: 200, headers: { "content-type": "application/json", "content-range": rows.length ? `0-${rows.length - 1}/${rows.length}` : "*/0" },
      });
    });
    const first = await loadLocalCatalogSnapshot({ url, key, fetchImpl });
    const second = await loadLocalCatalogSnapshot({ url, key, fetchImpl });
    expect(first).toEqual(second);
    expect(first.snapshotId).toMatch(/^local-[a-f0-9]{16}$/);
    expect(first.directProductCategorySlugs).toEqual(["pumps"]);
    expect(first.products[0]).toMatchObject({
      slug: "pump-one", category: "pumps", subcategory: "gear", compatibleBrands: ["man"],
      vehicleTypes: ["truck"], images: [{ url: "https://media.ayprom-gidravlika.kg/pump.jpg" }],
    });
    expect(requests.every((request) => request.method === "GET" && request.url.origin === url && request.key === key)).toBe(true);
    expect(requests.every((request) => request.prefer === "count=exact")).toBe(true);
    expect(requests.find((request) => request.url.pathname.endsWith("/category_brands"))?.url.searchParams.get("order"))
      .toBe("category_slug.asc,brand_slug.asc");
    expect(requests.find((request) => request.url.pathname.endsWith("/subcategories"))?.url.searchParams.get("order"))
      .toBe("slug.asc,category_slug.asc");
  });

  it("reads every row when PostgREST caps a page below the requested limit", async () => {
    const products = Array.from({ length: 5 }, (_, index) => ({
      ...(rowsFor("products")[0] as Record<string, unknown>), slug: `pump-${index}`,
    }));
    const productOffsets: number[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const requestUrl = new URL(String(input));
      const table = requestUrl.pathname.split("/").at(-1)!;
      const source = table === "products" ? products : rowsFor(table);
      const offset = Number(requestUrl.searchParams.get("offset"));
      if (table === "products") productOffsets.push(offset);
      const batch = source.slice(offset, offset + (table === "products" ? 2 : 1000));
      return new Response(JSON.stringify(batch), {
        status: batch.length < source.length ? 206 : 200,
        headers: { "content-range": batch.length ? `${offset}-${offset + batch.length - 1}/${source.length}` : "*/0" },
      });
    });
    const snapshot = await loadLocalCatalogSnapshot({ url, key, fetchImpl });
    expect(snapshot.products).toHaveLength(5);
    expect(productOffsets).toEqual([0, 2, 4]);
  });

  it("refuses a snapshot when the exact total is missing", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const table = new URL(String(input)).pathname.split("/").at(-1)!;
      const rows = rowsFor(table);
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: table === "products" ? {} : { "content-range": rows.length ? `0-${rows.length - 1}/${rows.length}` : "*/0" },
      });
    });
    await expect(loadLocalCatalogSnapshot({ url, key, fetchImpl })).rejects.toThrow("local_snapshot_count_invalid:products");
  });

  it("refuses a changed total between pages instead of exporting a mixed snapshot", async () => {
    const products = Array.from({ length: 3 }, (_, index) => ({
      ...(rowsFor("products")[0] as Record<string, unknown>), slug: `pump-${index}`,
    }));
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const requestUrl = new URL(String(input));
      const table = requestUrl.pathname.split("/").at(-1)!;
      const offset = Number(requestUrl.searchParams.get("offset"));
      const source = table === "products" ? products : rowsFor(table);
      const batch = source.slice(offset, offset + (table === "products" ? 2 : 1000));
      const total = table === "products" && offset > 0 ? 4 : source.length;
      return new Response(JSON.stringify(batch), {
        status: 200,
        headers: { "content-range": batch.length ? `${offset}-${offset + batch.length - 1}/${total}` : "*/0" },
      });
    });
    await expect(loadLocalCatalogSnapshot({ url, key, fetchImpl })).rejects.toThrow("local_snapshot_count_changed:products");
  });

  it("rejects a remote URL or service-role key before fetching", async () => {
    const fetchImpl = vi.fn();
    await expect(loadLocalCatalogSnapshot({ url: "https://example.supabase.co", key, fetchImpl })).rejects.toThrow("local_probe_invalid_binding");
    await expect(loadLocalCatalogSnapshot({ url, key: "sb_secret_nope", fetchImpl })).rejects.toThrow("local_probe_invalid_binding");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a sanitized table failure without response body or key", async () => {
    const fetchImpl = vi.fn(async () => new Response("sensitive database error", { status: 500 }));
    await expect(loadLocalCatalogSnapshot({ url, key, fetchImpl })).rejects.toThrow(/^local_snapshot_http_error:/);
    expect(fetchImpl).toHaveBeenCalled();
  });
});
