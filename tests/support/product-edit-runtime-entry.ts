// Test-only local composition: the real admin handler with the real legacy
// password ports, the real private readers AND the CAS update port. The
// application Worker (src/cloudflare/worker.ts) deliberately wires only the
// reads until static public pages can be republished after a product change.
import { createAdminHandler } from "@/cloudflare/admin/handler";
import { createLegacyAdminPorts } from "@/cloudflare/admin/legacy-admin-ports";
import { createAdminProductReader } from "@/cloudflare/admin/product-reader";
import { createAdminProductDetailReader } from "@/cloudflare/admin/product-detail-reader";
import { createAdminProductMutationPorts } from "@/cloudflare/admin/product-mutation-ports";

interface Env {
  SUPABASE_URL: string;
  ADMIN_SUPABASE_KEY: string;
  ADMIN_COOKIE_HMAC_KEY: string;
  ADMIN_PASSWORD?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

const entry = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/api/health") return Response.json({ status: "ok" });
    const backend = { SUPABASE_URL: env.SUPABASE_URL, ADMIN_SUPABASE_KEY: env.ADMIN_SUPABASE_KEY };
    const handler = createAdminHandler({
      ...createLegacyAdminPorts({ ...backend, ADMIN_PASSWORD: env.ADMIN_PASSWORD }),
      readProducts: createAdminProductReader(backend),
      readProduct: createAdminProductDetailReader(backend),
      updateProduct: createAdminProductMutationPorts(backend).update,
      assets: env.ASSETS ?? { fetch: async () => new Response(null, { status: 404 }) },
      secret: env.ADMIN_COOKIE_HMAC_KEY,
      clientIp: request.headers.get("cf-connecting-ip") ?? "127.0.0.1",
      now: Date.now,
    });
    return await handler(request) ?? new Response(null, { status: 404 });
  },
};

export default entry;
