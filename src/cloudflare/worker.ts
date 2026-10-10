import { createPinnedPublicCatalogSearchRpc } from "@/cloudflare/supabase-catalog-search";
import { API_SECURITY_HEADERS, createCloudflareWorkerApi } from "@/cloudflare/worker-api";
import { cachedCatalogSearch, type EdgeCacheLike, type SearchMemory } from "@/cloudflare/search-cache";
import { createAdminHandler } from "@/cloudflare/admin/handler";
import { createLegacyAdminPorts } from "@/cloudflare/admin/legacy-admin-ports";
import { createAdminProductReader } from "@/cloudflare/admin/product-reader";
import { createAdminProductDetailReader } from "@/cloudflare/admin/product-detail-reader";

interface AdminWorkerEnv extends Env {
  ADMIN_SUPABASE_KEY?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_COOKIE_HMAC_KEY?: string;
  ADMIN_CRYPTO_KEY?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

function adminConfigurationUnavailable(): Response {
  return new Response("Admin configuration unavailable", {
    status: 503,
    headers: { ...API_SECURITY_HEADERS, "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
  });
}

// Lives as long as this Worker instance: repeated queries inside one release are answered with no network at all.
const searchMemory: SearchMemory = new Map();

const worker = {
  async fetch(request: Request, env: Env, ctx?: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    try {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/api/admin" || pathname.startsWith("/api/admin/")) {
        const admin = env as AdminWorkerEnv;
        if (!admin.ADMIN_SUPABASE_KEY
          || !admin.ADMIN_COOKIE_HMAC_KEY || !admin.ADMIN_CRYPTO_KEY || !admin.ASSETS) return adminConfigurationUnavailable();
        const privatePorts = createLegacyAdminPorts({
          SUPABASE_URL: env.SUPABASE_URL,
          ADMIN_SUPABASE_KEY: admin.ADMIN_SUPABASE_KEY,
          ADMIN_PASSWORD: admin.ADMIN_PASSWORD,
          SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY,
          ADMIN_CRYPTO_KEY: admin.ADMIN_CRYPTO_KEY,
        });
        const handleAdmin = createAdminHandler({
          ...privatePorts,
          readProducts: createAdminProductReader({ SUPABASE_URL: env.SUPABASE_URL, ADMIN_SUPABASE_KEY: admin.ADMIN_SUPABASE_KEY }),
          // Read-only on purpose: product writes stay unwired here until a
          // mechanism republishes the static public pages after a change.
          readProduct: createAdminProductDetailReader({ SUPABASE_URL: env.SUPABASE_URL, ADMIN_SUPABASE_KEY: admin.ADMIN_SUPABASE_KEY }),
          assets: admin.ASSETS,
          secret: admin.ADMIN_COOKIE_HMAC_KEY,
          clientIp: request.headers.get("cf-connecting-ip") ?? "unknown",
          now: Date.now,
        });
        return await handleAdmin(request) ?? adminConfigurationUnavailable();
      }
      const handleRequest = createCloudflareWorkerApi({
        searchRpc: createPinnedPublicCatalogSearchRpc(env),
        reportError: (event) => {
          console.error(JSON.stringify({ message: "worker api request failed", ...event }));
        },
      });
      // Search answers are immutable per release, so they are cached at the edge (see search-cache.ts).
      const cache = typeof caches !== "undefined" ? (caches as unknown as { default?: EdgeCacheLike }).default : undefined;
      return await cachedCatalogSearch(request, {
        cache, memory: searchMemory, publicationId: (env as { PUBLICATION_ID?: string }).PUBLICATION_ID, waitUntil: (promise) => ctx?.waitUntil(promise), handle: handleRequest,
      });
    } catch {
      console.error(JSON.stringify({
        message: "worker request failed",
        code: "worker_configuration_error",
        route: new URL(request.url).pathname,
      }));
      return Response.json(
        {
          error: {
            code: "worker_configuration_error",
            message: "Worker configuration is unavailable",
          },
        },
        {
          status: 500,
          headers: { ...API_SECURITY_HEADERS, "cache-control": "no-store" },
        },
      );
    }
  },
};

export default worker;
