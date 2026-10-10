import { describe, expect, it, vi } from "vitest";
import { createAdminProductDetailReader } from "@/cloudflare/admin/product-detail-reader";

const bindings = { SUPABASE_URL: "https://db.example.test", ADMIN_SUPABASE_KEY: "sb_secret_fake09" };
const id = "4d331dcf-4243-4a29-aacd-93c30af433e6";
// Microseconds and a numeric offset exactly as PostgREST returns timestamptz.
const updatedAt = "2026-10-04T08:00:00.123456+00:00";
const row = {
  id, slug: "pump", name: "Pump", category_slug: "hydraulic-pumps", short_description: "Short",
  description: null, article: "A-1", published: false, availability: "in_stock",
  meta_title: null, meta_description: "Meta", updated_at: updatedAt,
  subcategories: { slug: "gear" },
  product_characteristics: [
    { attribute: "Second", value: "2", order: 2 },
    { attribute: "First", value: "1", order: 1 },
  ],
  product_brands: [{ brand_slug: "howo" }, { brand_slug: "faw" }],
  product_vehicle_types: [{ vehicle_type_slug: "dump-truck" }],
  vehicle_hotspots: [{ id: "h1" }, { id: "h2" }],
};

function setup(response: Response | (() => Response | Promise<Response>)) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetcher = vi.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: new URL(String(url)), init });
    return typeof response === "function" ? response() : response;
  });
  return { read: createAdminProductDetailReader(bindings, fetcher as unknown as typeof fetch), calls };
}

describe("private single-product reader for the thin admin edit form", () => {
  it("sends one bounded private GET by exact slug and maps every field the update RPC replaces", async () => {
    const { read, calls } = setup(Response.json([row]));
    await expect(read("pump")).resolves.toEqual({
      id, slug: "pump", name: "Pump", categorySlug: "hydraulic-pumps", subcategorySlug: "gear",
      shortDescription: "Short", description: null, article: "A-1", published: false, availability: "in_stock",
      metaTitle: null, metaDescription: "Meta", updatedAt,
      characteristics: [{ attribute: "First", value: "1" }, { attribute: "Second", value: "2" }],
      compatibleBrands: ["howo", "faw"], vehicleTypes: ["dump-truck"], hotspotCount: 2,
    });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url.origin + url.pathname).toBe("https://db.example.test/rest/v1/products");
    expect(url.searchParams.get("slug")).toBe("eq.pump");
    expect(url.searchParams.get("limit")).toBe("2");
    expect(url.searchParams.get("select")).toContain("updated_at");
    expect(url.searchParams.get("select")).toContain("product_characteristics(");
    expect(url.searchParams.has("published")).toBe(false);
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    expect(init.cache).toBe("no-store");
    expect(new Headers(init.headers).get("apikey")).toBe(bindings.ADMIN_SUPABASE_KEY);
    expect(String(url)).not.toContain(bindings.ADMIN_SUPABASE_KEY);
  });

  it("keeps the database timestamp string byte-for-byte for compare-and-set", async () => {
    for (const stamp of ["2026-10-04T08:00:00+00:00", "2026-10-04T08:00:00.1+00:00", "2026-10-04T08:00:00.999999Z"]) {
      const { read } = setup(Response.json([{ ...row, updated_at: stamp }]));
      expect((await read("pump"))?.updatedAt).toBe(stamp);
    }
  });

  it("returns null for an absent product and never invents data", async () => {
    const { read } = setup(Response.json([]));
    await expect(read("pump")).resolves.toBeNull();
  });

  it("refuses an invalid slug before any network request", async () => {
    for (const slug of ["", "Pump", "pump_1", "../x", "a".repeat(201), "pump?select=*"]) {
      const { read, calls } = setup(Response.json([row]));
      await expect(read(slug)).rejects.toThrow("Admin product unavailable");
      expect(calls).toHaveLength(0);
    }
  });

  it.each([
    ["two rows for one slug", () => Response.json([row, row])],
    ["a different slug", () => Response.json([{ ...row, slug: "other" }])],
    ["a non-uuid id", () => Response.json([{ ...row, id: "1" }])],
    ["a parsed Date-like timestamp", () => Response.json([{ ...row, updated_at: "Sun Oct 04 2026" }])],
    ["an unknown availability", () => Response.json([{ ...row, availability: "sold" }])],
    ["a non-boolean published", () => Response.json([{ ...row, published: "true" }])],
    ["a malformed characteristic", () => Response.json([{ ...row, product_characteristics: [{ attribute: 1, value: "x", order: 1 }] }])],
    ["a malformed brand list", () => Response.json([{ ...row, product_brands: "howo" }])],
    ["a non-array payload", () => Response.json({ id })],
    ["broken JSON", () => new Response("[{", { headers: { "content-type": "application/json" } })],
    ["an oversized body", () => new Response(`[${JSON.stringify({ ...row, description: "x".repeat(70_000) })}]`)],
    ["a database error with private detail", () => new Response(JSON.stringify({ message: bindings.ADMIN_SUPABASE_KEY }), { status: 500 })],
    ["a redirect to another host", () => new Response(null, { status: 302, headers: { location: "https://sink.example/steal" } })],
  ])("fails closed without leaking anything on %s", async (_label, response) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { read, calls } = setup(response);
    const failure = await read("pump").then(() => null, (reason: unknown) => reason);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Admin product unavailable");
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain(bindings.ADMIN_SUPABASE_KEY);
    error.mockRestore();
  });

  it("refuses an unusable configuration before any network request", async () => {
    for (const config of [
      { SUPABASE_URL: "ftp://db.example.test", ADMIN_SUPABASE_KEY: "key" },
      { SUPABASE_URL: "https://user:pass@db.example.test", ADMIN_SUPABASE_KEY: "key" },
      { SUPABASE_URL: "https://db.example.test", ADMIN_SUPABASE_KEY: " " },
      { SUPABASE_URL: "https://db.example.test", ADMIN_SUPABASE_KEY: "key with space" },
    ]) {
      const fetcher = vi.fn();
      await expect(createAdminProductDetailReader(config, fetcher as unknown as typeof fetch)("pump"))
        .rejects.toThrow("Admin product unavailable");
      expect(fetcher).not.toHaveBeenCalled();
    }
  });
});
