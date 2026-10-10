import { matchRoute } from "../admin-spa/route-table";

// Everything the admin Worker answers itself: the app shell for known pages, a real 404 for the
// rest, the RPC endpoint and a health check. Static files (scripts, styles, images) never reach
// this code because the platform serves them directly.
export interface AssetsBinding {
  fetch(input: Request | URL | string): Promise<Response>;
}

export interface AdminRoutingDeps {
  assets: AssetsBinding;
  rpc: (request: Request, actionName: string) => Promise<Response>;
}

interface PublishedRoute {
  segments: string[];
}

const RPC_PREFIX = "/api/admin/rpc/";
const routesByAssets = new WeakMap<AssetsBinding, Promise<PublishedRoute[]>>();

// The route list is a build output next to the app; one read per Worker instance is enough.
function loadRoutes(assets: AssetsBinding, origin: string): Promise<PublishedRoute[]> {
  let request = routesByAssets.get(assets);
  if (!request) {
    request = assets
      .fetch(new URL("/admin-routes.json", origin))
      .then(async (response) => {
        if (!response.ok) throw new Error("admin_routes_unavailable");
        return (await response.json()) as PublishedRoute[];
      })
      .catch((error) => {
        routesByAssets.delete(assets);
        throw error;
      });
    routesByAssets.set(assets, request);
  }
  return request;
}

function withNoStore(response: Response, status: number): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status, headers });
}

export async function routeAdminRequest(request: Request, deps: AdminRoutingDeps): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === "/api/health") return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });

  if (pathname.startsWith(RPC_PREFIX)) {
    const name = decodeURIComponent(pathname.slice(RPC_PREFIX.length));
    return name ? deps.rpc(request, name) : new Response("Not found", { status: 404 });
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    const known = matchRoute(await loadRoutes(deps.assets, url.origin), pathname) !== null;
    const page = await deps.assets.fetch(new URL(known ? "/" : "/admin-404", url.origin));
    return known ? page : withNoStore(page, 404);
  }

  return new Response("Not found", { status: 404 });
}
