import { describe, expect, it, vi } from "vitest";
import { routeAdminRequest, type AdminRoutingDeps } from "@/cloudflare/admin-worker/routing";

const ORIGIN = "https://admin.test";
const ROUTES = [
  { pattern: "/admin", segments: ["admin"], protected: true },
  { pattern: "/admin/brands", segments: ["admin", "brands"], protected: true },
  { pattern: "/admin/brands/:slug/edit", segments: ["admin", "brands", ":slug", "edit"], protected: true },
  { pattern: "/admin/login", segments: ["admin", "login"], protected: false },
];

function harness() {
  const assetCalls: string[] = [];
  const rpc = vi.fn(async (_request: Request, name: string) => new Response(`rpc:${name}`));
  const deps: AdminRoutingDeps = {
    assets: {
      fetch: async (input) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        assetCalls.push(url.pathname);
        if (url.pathname === "/admin-routes.json") return new Response(JSON.stringify(ROUTES), { headers: { "content-type": "application/json" } });
        if (url.pathname === "/") return new Response("<html>app</html>", { headers: { "content-type": "text/html; charset=utf-8", etag: "x" } });
        if (url.pathname === "/admin-404") return new Response("<html>404 page</html>", { headers: { "content-type": "text/html; charset=utf-8" } });
        return new Response("missing", { status: 404 });
      },
    },
    rpc,
  };
  const send = (path: string, init?: RequestInit) => routeAdminRequest(new Request(`${ORIGIN}${path}`, init), deps);
  return { send, assetCalls, rpc };
}

describe("admin Worker routing", () => {
  it("serves the app shell for every known admin address, including ones with parameters", async () => {
    const { send } = harness();
    for (const path of ["/admin", "/admin/", "/admin/brands", "/admin/brands/gates/edit", "/admin/brands/%D0%B1%D1%80/edit", "/admin/login?error=1"]) {
      const response = await send(path);
      expect(response.status, path).toBe(200);
      expect(await response.text()).toBe("<html>app</html>");
    }
  });

  it("answers an unknown admin address with a real 404 page that is never cached", async () => {
    const { send } = harness();
    for (const path of ["/admin/qa-e2e-global-not-found", "/admin/brands/gates", "/admin/brands/a/edit/extra"]) {
      const response = await send(path);
      expect(response.status, path).toBe(404);
      expect(await response.text()).toBe("<html>404 page</html>");
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("hands RPC calls to the RPC handler with the decoded action name", async () => {
    const { send, rpc } = harness();
    const response = await send("/api/admin/rpc/get%41dminBrands", { method: "POST" });
    expect(await response.text()).toBe("rpc:getAdminBrands");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect((await send("/api/admin/rpc/", { method: "POST" })).status).toBe(404);
  });

  it("has a health check and no other API", async () => {
    const { send } = harness();
    expect(await (await send("/api/health")).json()).toEqual({ ok: true });
    expect((await send("/api/other")).status).toBe(404);
  });

  it("allows only reading for pages and loads the route list once", async () => {
    const { send, assetCalls } = harness();
    expect((await send("/admin/brands", { method: "POST", body: "x" })).status).toBe(405);
    await send("/admin/brands");
    await send("/admin/brands/a/edit");
    await send("/admin/nothing");
    expect(assetCalls.filter((path) => path === "/admin-routes.json")).toHaveLength(1);
  });
});
