import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  authorize: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/actions", () => ({ requireAdminSession: state.authorize }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("@/lib/supabase/admin", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { createAdminClient: () => createClient("http://127.0.0.1:54321", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: state.fetch },
  }) };
});
import { commitProductImport, previewProductImport } from "@/lib/admin/product-import-actions";

type Row = Record<string, string | null>;
let rows: Record<string, Row[]>;
let failTable: string | undefined;
let failOffset: number;
let writes: number;
let reads: URL[];
let committed: unknown;

function upload(row: string) {
  const form = new FormData();
  form.set("file", new File([
    "name,article,category,subcategory,short_description,brands,vehicle_types\n" + row,
  ], "import.csv", { type: "text/csv" }));
  return form;
}

beforeEach(() => {
  state.authorize.mockReset();
  state.revalidate.mockReset();
  rows = { categories: [{ slug: "pumps" }], subcategories: [], brands: [], vehicle_types: [], products: [] };
  failTable = undefined;
  failOffset = 0;
  writes = 0;
  committed = undefined;
  reads = [];
  state.fetch.mockReset().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const table = url.pathname.split("/").at(-1)!;
    if (url.pathname.includes("/rpc/")) {
      writes++;
      committed = JSON.parse(String(init?.body));
      return new Response("[]", { headers: { "content-type": "application/json" } });
    }
    reads.push(url);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    if (table === failTable && offset >= failOffset) {
      return new Response(JSON.stringify({ code: "XX000", message: "private-backend-detail" }), { status: 500 });
    }
    const limit = Math.min(1000, Number(url.searchParams.get("limit") ?? 1000));
    return new Response(JSON.stringify(rows[table].slice(offset, offset + limit)), {
      headers: { "content-type": "application/json" },
    });
  });
});

describe("import reference completeness through the real Supabase query builder", () => {
  it("matches an existing article beyond the server's first 1000 rows", async () => {
    rows.products = Array.from({ length: 1000 }, (_, i) => ({ slug: `p-${i}`, article: `A-${i}` }));
    rows.products.push({ slug: "existing-pump", article: "LAST" });
    const result = await previewProductImport(upload("Renamed,LAST,pumps,,Description,,"));
    expect(result.errors).toEqual([]);
    expect(result.validRows[0]).toMatchObject({ slug: "existing-pump", matchedExisting: true });
    expect(reads.filter((url) => url.pathname.endsWith("/products")).every((url) => url.searchParams.get("order") === "slug.asc")).toBe(true);
  });

  it("does not reuse a slug found on a later page", async () => {
    rows.products = Array.from({ length: 1000 }, (_, i) => ({ slug: `p-${i}`, article: null }));
    rows.products.push({ slug: "new-pump", article: null });
    const result = await previewProductImport(upload("New pump,,pumps,,Description,,"));
    expect(result.validRows[0]).toMatchObject({ slug: "new-pump-2", matchedExisting: false });
  });

  it("passes the existing later-page product slug to the commit RPC", async () => {
    rows.products = Array.from({ length: 1000 }, (_, i) => ({ slug: `p-${i}`, article: `A-${i}` }));
    rows.products.push({ slug: "existing-pump", article: "LAST" });
    await commitProductImport(upload("Renamed,LAST,pumps,,Description,,"));
    expect(writes).toBe(1);
    expect(committed).toMatchObject({ rows: [{ slug: "existing-pump", article: "LAST" }] });
  });

  it("finishes an exact multiple of pages after the empty trailing page", async () => {
    rows.products = Array.from({ length: 1000 }, (_, i) => ({ slug: `p-${i}`, article: `A-${i}` }));
    const result = await previewProductImport(upload("Renamed,A-999,pumps,,Description,,"));
    expect(result.validRows[0]).toMatchObject({ slug: "p-999", matchedExisting: true });
    expect(reads.filter((url) => url.pathname.endsWith("/products")).map((url) => url.searchParams.get("offset"))).toEqual(["0", "500", "1000"]);
  });

  it("loads later pages from all four classification tables", async () => {
    for (const table of ["categories", "brands", "vehicle_types"]) {
      rows[table] = Array.from({ length: 1000 }, (_, i) => ({ slug: `item-${i}` }));
    }
    rows.categories.push({ slug: "pumps" });
    rows.brands.push({ slug: "last-brand" });
    rows.vehicle_types.push({ slug: "last-truck" });
    rows.subcategories = Array.from({ length: 1000 }, (_, i) => ({ id: `id-${i}`, slug: `sub-${i}`, category_slug: "pumps" }));
    rows.subcategories.push({ id: "last-sub-id", slug: "last-sub", category_slug: "pumps" });
    const result = await previewProductImport(upload("Pump,,pumps,last-sub,Description,last-brand,last-truck"));
    expect(result.errors).toEqual([]);
    expect(result.validRows[0]).toMatchObject({ subcategoryId: "last-sub-id", brandSlugs: ["last-brand"], vehicleTypeSlugs: ["last-truck"] });
    expect(reads.filter((url) => url.pathname.endsWith("/subcategories")).every((url) => url.searchParams.get("order") === "id.asc")).toBe(true);
  });

  it.each(["categories", "subcategories", "brands", "vehicle_types", "products"])("blocks commit when %s cannot be loaded", async (table) => {
    failTable = table;
    await expect(commitProductImport(upload("Pump,,pumps,,Description,,"))).rejects.toThrow("Не удалось загрузить справочники для импорта");
    expect(writes).toBe(0);
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it("blocks commit after a later page fails instead of using a partial reference", async () => {
    rows.products = Array.from({ length: 1000 }, (_, i) => ({ slug: `p-${i}`, article: null }));
    failTable = "products";
    failOffset = 500;
    await expect(commitProductImport(upload("Pump,,pumps,,Description,,"))).rejects.toThrow("Не удалось загрузить справочники для импорта");
    expect(writes).toBe(0);
  });

  it("authorizes before any reference read or write", async () => {
    state.authorize.mockRejectedValue(new Error("Unauthorized"));
    await expect(commitProductImport(upload("Pump,,pumps,,Description,,"))).rejects.toThrow("Unauthorized");
    expect(state.fetch).not.toHaveBeenCalled();
  });
});
