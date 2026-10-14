// Test-only composition of the existing Supabase Auth adapter with the actual
// admin handler. It is never bundled into the product Worker.
import { createAdminHandler } from "@/cloudflare/admin/handler";
import { createSupabaseAdminPorts } from "@/cloudflare/admin/supabase-ports";

interface ProbeEnv {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  ADMIN_SUPABASE_KEY: string;
  ADMIN_AUTH_EMAIL: string;
  ADMIN_AUTH_USER_ID: string;
  ADMIN_COOKIE_HMAC_KEY: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const supabaseAuthFeasibilityEntry = {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    if (new URL(request.url).pathname === "/api/health") return Response.json({ ok: true });
    const privatePorts = createSupabaseAdminPorts(env);
    const handleAdmin = createAdminHandler({
      ...privatePorts,
      assets: env.ASSETS,
      secret: env.ADMIN_COOKIE_HMAC_KEY,
      clientIp: "127.0.0.1",
      now: Date.now,
    });
    return await handleAdmin(request) ?? new Response("Not found", { status: 404 });
  },
};

export default supabaseAuthFeasibilityEntry;
