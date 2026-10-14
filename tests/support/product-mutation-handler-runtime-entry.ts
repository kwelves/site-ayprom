// Test-only composition: real admin handler plus real private mutation ports.
// The application Worker deliberately does not expose these ports yet.
import { createAdminHandler } from "@/cloudflare/admin/handler";
import { createAdminProductMutationPorts } from "@/cloudflare/admin/product-mutation-ports";

interface Env { SUPABASE_URL: string; ADMIN_SUPABASE_KEY: string; ADMIN_COOKIE_HMAC_KEY: string }

const entry = {
  fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/api/health") return Promise.resolve(Response.json({ status: "ok" }));
    const products = createAdminProductMutationPorts(env);
    const handler = createAdminHandler({
      reserve: async () => { throw new Error("not_used"); },
      finish: async () => { throw new Error("not_used"); },
      verifyPassword: async () => false,
      credentialVersion: async () => 1,
      createProduct: products.create,
      updateProduct: products.update,
      assets: { fetch: async () => new Response(null, { status: 404 }) },
      secret: env.ADMIN_COOKIE_HMAC_KEY,
      clientIp: "127.0.0.1",
      now: Date.now,
    });
    return handler(request).then((response) => response ?? new Response(null, { status: 404 }));
  },
};

export default entry;
