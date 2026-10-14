import {
  CatalogSearchFilterError,
  executeCatalogSearch,
  parseCatalogSearchParams,
  type CatalogSearchRpc,
  type ProductFilters,
} from "@/lib/catalog-search-contract";

export interface CloudflareWorkerApiDependencies {
  searchRpc: CatalogSearchRpc;
  reportError?: (event: CloudflareWorkerApiErrorEvent) => void;
}

export interface CloudflareWorkerApiErrorEvent {
  code: "catalog_search_failed";
  route: "/api/catalog/search";
}

// Cloudflare применяет статические `_headers` только к ответам Static Assets,
// но не к ответам Worker, поэтому Worker выставляет защитные заголовки сам —
// на каждом своём ответе. Значения, кроме CSP, дословно повторяют
// next.config.ts (сверяет tests/cloudflare-worker-api-headers.test.ts).
// CSP другая: сайтовая описывает HTML-документ и зависит от origin'ов
// Supabase/R2 из окружения, а JSON-ответ не загружает ресурсов вовсе.
export const API_SECURITY_HEADERS = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  "cross-origin-opener-policy": "same-origin",
  // Браузеры игнорируют HSTS по http, поэтому локальный workerd не страдает.
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
} as const;

const JSON_HEADERS = {
  ...API_SECURITY_HEADERS,
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
} as const;

export function createCloudflareWorkerApi({
  searchRpc,
  reportError,
}: CloudflareWorkerApiDependencies) {
  return async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      if (request.method !== "GET") return methodNotAllowed();
      return jsonResponse({ status: "ok" });
    }

    if (url.pathname === "/api/catalog/search") {
      if (request.method !== "GET") return methodNotAllowed();

      let filters: ProductFilters;
      try {
        filters = parseCatalogSearchParams(url.searchParams);
      } catch (error) {
        if (!(error instanceof CatalogSearchFilterError)) throw error;
        // Ошибка клиента, а не сбой upstream: Supabase не вызывается и
        // reportError не засоряется.
        return jsonResponse(
          {
            error: {
              code: "invalid_catalog_search",
              message: "Catalog search filters are invalid",
            },
          },
          400,
        );
      }

      try {
        const page = await executeCatalogSearch(filters, searchRpc);
        return jsonResponse(page);
      } catch {
        reportError?.({
          code: "catalog_search_failed",
          route: "/api/catalog/search",
        });
        return jsonResponse(
          {
            error: {
              code: "catalog_search_failed",
              message: "Catalog search is temporarily unavailable",
            },
          },
          502,
        );
      }
    }

    return jsonResponse(
      { error: { code: "not_found", message: "Not found" } },
      404,
    );
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function methodNotAllowed(): Response {
  return new Response(
    JSON.stringify({ error: { code: "method_not_allowed", message: "Method not allowed" } }),
    {
      status: 405,
      headers: { ...JSON_HEADERS, allow: "GET" },
    },
  );
}
