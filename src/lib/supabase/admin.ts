import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireServerEnv } from "@/lib/env";

// Service-role key — bypasses RLS entirely. Only ever import this from
// src/app/admin/** or src/lib/admin/**, never from public query functions.
// The `server-only` import above turns an accidental import from a Client
// Component into a build error rather than a silent runtime failure.
// Plain createClient (not @supabase/ssr's createServerClient) since there's
// no end-user Supabase Auth session to sync via cookies here — our own
// admin_session cookie (src/lib/admin/session.ts) is a separate mechanism.
export function createAdminClient() {
  return createSupabaseClient(requireServerEnv("NEXT_PUBLIC_SUPABASE_URL"), requireServerEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false },
  });
}
