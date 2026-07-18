import { createBrowserClient } from "@supabase/ssr";

// Public/publishable key only — RLS already allows anonymous reads on the
// catalog tables, so this is safe to use directly in the browser (Breadcrumb
// is the only current client-side caller).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
