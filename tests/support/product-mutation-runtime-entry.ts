// Test-only workerd entry. Fixed data keeps secrets and arbitrary input out of
// its response; the actual product mutation port runs unchanged inside workerd.
import { AdminProductMutationError, createAdminProductMutationPorts } from "@/cloudflare/admin/product-mutation-ports";

interface Env { SUPABASE_URL: string; ADMIN_SUPABASE_KEY: string }

const fields = {
  slugBase: "pump", name: "Hydraulic pump", categorySlug: "hydraulic-pumps", subcategorySlug: null,
  shortDescription: "", description: null, article: null, published: false,
  availability: "in_stock" as const, metaTitle: null, metaDescription: null,
  characteristics: [], compatibleBrands: ["man"], vehicleTypes: [],
};

const runtimeEntry = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/api/health") return Response.json({ status: "ok" });
    const ports = createAdminProductMutationPorts(env);
    try {
      if (path === "/create") {
        const created = await ports.create(fields);
        return Response.json({ ok: true, ...created });
      }
      if (path === "/update") {
        const updated = await ports.update({
          slug: "pump", newSlug: "new-pump", expectedUpdatedAt: "2026-10-01T10:22:33.123456+00:00", fields,
        });
        return Response.json({ ok: true, ...updated });
      }
    } catch (error) {
      return Response.json({ ok: false, code: error instanceof AdminProductMutationError ? error.code : "unexpected_error" });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  },
};

export default runtimeEntry;
