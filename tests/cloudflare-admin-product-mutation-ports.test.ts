import { describe, expect, it, vi } from "vitest";
import { createAdminProductMutationPorts, AdminProductMutationError } from "@/cloudflare/admin/product-mutation-ports";

const bindings = { SUPABASE_URL: "http://127.0.0.1:54998", ADMIN_SUPABASE_KEY: "sb_secret_fake11" };
const fields = {
  slugBase: "pump", name: "Pump", categorySlug: "hydraulic-pumps", subcategorySlug: null,
  shortDescription: "", description: null, article: null, published: false,
  availability: "in_stock" as const, metaTitle: null, metaDescription: null,
  characteristics: [{ attribute: "Pressure", value: "200 bar" }], compatibleBrands: ["man"], vehicleTypes: [],
};
const productId = "4d331dcf-4243-4a29-aacd-93c30af433e6";

function setup(response: Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = vi.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return response;
  });
  return { ports: createAdminProductMutationPorts(bindings, fetcher as unknown as typeof fetch), calls };
}

describe("private product mutation RPC ports", () => {
  it("creates exactly one product through the existing atomic RPC with the private key only in a header", async () => {
    const { ports, calls } = setup(Response.json([{ out_id: productId, out_slug: "pump" }]));
    await expect(ports.create(fields)).resolves.toEqual({ id: productId, slug: "pump" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${bindings.SUPABASE_URL}/rest/v1/rpc/create_product_with_relations`);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(new Headers(calls[0].init.headers).get("apikey")).toBe(bindings.ADMIN_SUPABASE_KEY);
    expect(new Headers(calls[0].init.headers).get("authorization")).toBeNull();
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      p_slug_base: "pump", p_name: "Pump", p_category_slug: "hydraulic-pumps", p_subcategory_slug: null,
      p_short_description: "", p_description: null, p_article: null, p_published: false,
      p_availability: "in_stock", p_meta_title: null, p_meta_description: null,
      p_characteristics: [{ attribute: "Pressure", value: "200 bar" }], p_compatible_brands: ["man"], p_vehicle_types: [],
    });
    expect(calls[0].url).not.toContain(bindings.ADMIN_SUPABASE_KEY);
  });

  it("updates by slug and exact timestamp through the existing atomic RPC", async () => {
    const timestamp = "2026-10-01T10:22:33.123456+00:00";
    const { ports, calls } = setup(Response.json([{ out_id: productId, out_updated_at: "2026-10-03T10:22:33.654321+00:00" }]));
    await expect(ports.update({ slug: "old-pump", newSlug: "pump", expectedUpdatedAt: timestamp, fields }))
      .resolves.toEqual({ id: productId, updatedAt: "2026-10-03T10:22:33.654321+00:00" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${bindings.SUPABASE_URL}/rest/v1/rpc/update_product_with_slug`);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      p_slug: "old-pump", p_new_slug: "pump", p_expected_updated_at: timestamp,
      p_published: false, p_compatible_brands: ["man"],
    });
  });

  it("treats SQL stale-version code as conflict and never returns the backend text", async () => {
    const { ports } = setup(Response.json({ code: "55000", message: "private stale details" }, { status: 400 }));
    await expect(ports.update({ slug: "pump", newSlug: "pump", expectedUpdatedAt: "2026-10-01T10:22:33.123456+00:00", fields }))
      .rejects.toMatchObject({ code: "conflict", message: "Product changed concurrently" });
  });

  it("recognizes a stale update when real PostgREST maps SQL 55000 to HTTP 500", async () => {
    const { ports } = setup(Response.json({ code: "55000", message: "private stale details" }, { status: 500 }));
    await expect(ports.update({ slug: "pump", newSlug: "pump", expectedUpdatedAt: "2026-10-01T10:22:33.123456+00:00", fields }))
      .rejects.toMatchObject({ code: "conflict", message: "Product changed concurrently" });
  });

  it("classifies the intentional SQL input code 22023 as invalid input without returning its text", async () => {
    const { ports } = setup(Response.json({ code: "22023", message: "Выбранная категория не найдена. sb_secret_x" }, { status: 400 }));
    const failure = await ports.update({ slug: "pump", newSlug: "pump", expectedUpdatedAt: "2026-10-01T10:22:33.123456+00:00", fields })
      .then(() => null, (reason: unknown) => reason);
    expect(failure).toMatchObject({ code: "input_invalid", message: "Product mutation unavailable" });
    expect(String((failure as Error).message)).not.toContain("sb_secret_x");
    await expect(setup(Response.json({ code: "22023", message: "dup" }, { status: 400 })).ports.create(fields))
      .rejects.toMatchObject({ code: "input_invalid" });
    // Only the documented status is trusted: a 22023 body on a 500 stays a backend failure.
    await expect(setup(Response.json({ code: "22023" }, { status: 500 })).ports.update({
      slug: "pump", newSlug: "pump", expectedUpdatedAt: "2026-10-01T10:22:33.123456+00:00", fields,
    })).rejects.toMatchObject({ code: "backend_unavailable" });
  });

  it("classifies exactly the codes the legacy Next adapter treats as intentional", async () => {
    // Parity with the unchanged legacy adapter: these and only these SQLSTATEs
    // become an admin-facing outcome; everything else stays a generic failure.
    const { isIntentionalProductRpcError } = await import("@/lib/admin/product-rpc-error");
    for (const code of ["22023", "55000", "23505", "23503", "42501", "P0001", "XX000"]) {
      const { ports } = setup(Response.json({ code, message: "m" }, { status: code === "55000" ? 500 : 400 }));
      const failure = await ports.update({ slug: "pump", newSlug: "pump", expectedUpdatedAt: "2026-10-01T10:22:33.123456+00:00", fields })
        .then(() => null, (reason: unknown) => reason as AdminProductMutationError);
      expect(failure?.code !== "backend_unavailable").toBe(isIntentionalProductRpcError({ code, message: "m" }));
    }
  });

  it("still treats an unrelated HTTP 500 as an unavailable backend", async () => {
    const { ports } = setup(Response.json({ code: "XX000", message: "private system details" }, { status: 500 }));
    await expect(ports.update({ slug: "pump", newSlug: "pump", expectedUpdatedAt: "2026-10-01T10:22:33.123456+00:00", fields }))
      .rejects.toMatchObject({ code: "backend_unavailable", message: "Product mutation unavailable" });
  });

  it.each([
    ["empty rows", []], ["two rows", [{ out_id: productId, out_slug: "pump" }, { out_id: productId, out_slug: "pump-2" }]],
    ["wrong row", [{ out_id: "not-a-uuid", out_slug: "pump" }]],
  ])("rejects malformed create result: %s", async (_case, response) => {
    const { ports } = setup(Response.json(response));
    await expect(ports.create(fields)).rejects.toMatchObject({ code: "response_invalid" });
  });

  it("fails closed on backend outage", async () => {
    const { ports } = setup(Response.json({ code: "permission_denied", message: "private details" }, { status: 403 }));
    await expect(ports.create(fields)).rejects.toMatchObject({ code: "backend_unavailable" });
  });

  it("rejects bad input before any request", async () => {
    const fetcher = vi.fn();
    const ports = createAdminProductMutationPorts(bindings, fetcher as unknown as typeof fetch);
    await expect(ports.create({ ...fields, name: "" })).rejects.toBeInstanceOf(AdminProductMutationError);
    await expect(ports.update({ slug: "pump", newSlug: "pump", expectedUpdatedAt: "", fields })).rejects.toMatchObject({ code: "input_invalid" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
