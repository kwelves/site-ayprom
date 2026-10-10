import { localProbeBindings } from "@/cloudflare/static-build/local-browser-probe";
import { parseWorkersBuildAllowlist, resolveWorkersBuildBinding } from "@/cloudflare/static-build/producer/workers-build-config";

// Node-only catalog data source for a diagnostic static build. The public
// NEXT_PUBLIC_* values can name the eventual browser origin independently.
export function resolveStaticBuildSupabaseBindings(env: Record<string, string | undefined>): {
  url: string;
  key: string;
  cacheNonce?: string;
} | null {
  if (env.AYPROM_STATIC_BUILD !== "1") return null;
  const url = env.AYPROM_STATIC_BUILD_SUPABASE_URL;
  const key = env.AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY;
  if (!url && !key) return null;
  if (!url || !key) throw new Error("static_build_supabase_bindings_incomplete");
  if (env.AYPROM_WORKERS_BUILD_MODE === "workers-build") {
    const resolved = resolveWorkersBuildBinding({
      mode: "workers-build",
      supabaseUrl: url,
      publishableKey: key,
      allowlist: parseWorkersBuildAllowlist(env.AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST),
    });
    if (!resolved.ok) throw new Error("workers_build_binding_rejected");
    const cacheNonce = env.AYPROM_STATIC_BUILD_CACHE_NONCE;
    if (cacheNonce !== undefined && !/^[a-f0-9]{32}$/.test(cacheNonce)) {
      throw new Error("static_build_cache_nonce_invalid");
    }
    return {
      url: resolved.url,
      key: resolved.key,
      ...(cacheNonce ? { cacheNonce } : {}),
    };
  }
  const publicBindings = localProbeBindings(url, key);
  const cacheNonce = env.AYPROM_STATIC_BUILD_CACHE_NONCE;
  if (cacheNonce !== undefined && !/^[a-f0-9]{32}$/.test(cacheNonce)) {
    throw new Error("static_build_cache_nonce_invalid");
  }
  return {
    url: publicBindings.SUPABASE_URL,
    key: publicBindings.SUPABASE_PUBLISHABLE_KEY,
    ...(cacheNonce ? { cacheNonce } : {}),
  };
}
