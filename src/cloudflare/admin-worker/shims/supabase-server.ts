import { createAdminClient } from "@/lib/supabase/admin";

// In the admin Worker the public catalog readers (`@/lib/queries/*`) feed the product forms'
// drop-down lists. They must see the live tables (a category created a minute ago has to be
// selectable), which the anonymous key cannot read once the publication snapshots are in place,
// so they read through the service-role client instead. Only the whitelisted readers in
// `index.ts` are reachable from the browser.
export async function createClient() {
  return createAdminClient();
}
