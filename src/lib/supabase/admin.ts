import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role key — bypasses RLS entirely. Only ever import this from
// src/app/admin/** or src/lib/admin/**, never from public query functions.
// Plain createClient (not @supabase/ssr's createServerClient) since there's
// no end-user Supabase Auth session to sync via cookies here — our own
// admin_session cookie (src/lib/admin/session.ts) is a separate mechanism.
export function createAdminClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
}
