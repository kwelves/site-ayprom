import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Public/publishable key — same as the browser client. Every public page
// reads through RLS as the anonymous role, which is exactly what we want:
// no service_role key here, that's reserved for the future admin backend.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component render — safe to ignore since
            // no auth session needs refreshing on these public read-only pages.
          }
        },
      },
    }
  );
}
