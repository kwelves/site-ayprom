import { createClient as createSupabaseClient } from "@supabase/supabase-js";

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
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
}
