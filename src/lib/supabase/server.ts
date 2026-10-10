import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireServerEnv } from "@/lib/env";
import { resolveStaticBuildSupabaseBindings } from "@/lib/supabase/static-build-bindings";

// Public/publishable key — same as the browser client. Every public page
// reads through RLS as the anonymous role, which is exactly what we want:
// no service_role key here, that's reserved for the admin backend.
//
// Plain createClient (not @supabase/ssr's createServerClient): there's no
// end-user Supabase Auth session to sync via cookies on this public,
// read-only catalog, and calling cookies() at all — even just to wire up an
// unused adapter — is a Next.js "dynamic API" that forces every page using
// it into per-request rendering, overriding any `revalidate` export. A
// stateless client keeps these pages eligible for ISR.
export async function createClient() {
  const staticBuildSource = resolveStaticBuildSupabaseBindings(process.env);
  return createSupabaseClient(
    staticBuildSource?.url ?? requireServerEnv("NEXT_PUBLIC_SUPABASE_URL"),
    staticBuildSource?.key ?? requireServerEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    // A diagnostic crawl can rebuild against the same loopback Supabase URL
    // after its data changed. Next's persistent fetch cache keys on headers,
    // so a fresh per-build nonce prevents a previous snapshot leaking into
    // the sitemap or frozen HTML. Never add this header on the Vercel path.
    staticBuildSource?.cacheNonce
      ? { global: { headers: { "x-ayprom-static-build-cache": staticBuildSource.cacheNonce } } }
      : undefined,
  );
}
