import { describe, expect, it } from "vitest";
import { createAdminHandler } from "@/cloudflare/admin/handler";
import { createSessionCodec } from "@/lib/admin/session-codec";
import type { AdminAuthPorts } from "@/cloudflare/admin/contracts";

const secret = "local-readonly-products-session-test-secret";
const now = Date.parse("2026-09-30T01:00:00Z");
const origin = "https://example.test";
const item = { id: "p1", slug: "draft", name: '<script>alert("x")</script>', article: "A&1", published: false };
function setup() {
  let reads = 0;
  const ports = {
    secret, now: () => now, clientIp: "test", reserve: async () => ({ allowed: false, retryAfter: 1, reservationId: null }),
    finish: async () => 0, verifyPassword: async () => false, credentialVersion: async () => 1,
    assets: { fetch: async () => new Response("unused") },
    readProducts: async (query: { q: string; page: number }) => {
      reads++;
      return { items: [item], page: query.page, pageSize: 50, total: 101, totalPages: 3 };
    },
  } satisfies AdminAuthPorts;
  return { ports, reads: () => reads, run: (request: Request) => createAdminHandler(ports)(request) };
}
async function request(route: string, token?: string, method = "GET") {
  const cookie = token ?? await createSessionCodec(secret, () => now).create({ credentialVersion: 1 });
  return new Request(`${origin}${route}`, { method, headers: { cookie: `admin_session=${cookie}` } });
}
describe("protected read-only product list", () => {
  it("denies guests before reading drafts", async () => {
    const app = setup();
    const response = await app.run(new Request(`${origin}/api/admin/products`));
    expect(response?.status).toBe(401);
    expect(app.reads()).toBe(0);
    expect(await response?.text()).not.toContain("draft");
  });
  it("returns a bounded uncached page for a valid session", async () => {
    const app = setup();
    const response = await app.run(await request("/api/admin/products?q=test&page=2"));
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ items: [item], page: 2, pageSize: 50, total: 101, totalPages: 3 });
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });
  it("escapes product data and preserves search on page links without JavaScript", async () => {
    const app = setup();
    const response = await app.run(await request("/admin/products?q=%22%3Ctest%3E&page=2"));
    expect(response?.status).toBe(200);
    const html = await response!.text();
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script");
    expect(html).toContain("Черновик");
    expect(html).toContain("page=3");
    expect(html).toContain("%3Ctest%3E");
    expect(response?.headers.get("x-robots-tag")).toContain("noindex");
  });
  it.each(["0", "-1", "1.5", "1e2", "100001", "bad"])("rejects invalid page %s without reading products", async (page) => {
    const app = setup();
    expect((await app.run(await request(`/api/admin/products?page=${page}`)))?.status).toBe(400);
    expect(app.reads()).toBe(0);
  });
  it("denies forged, expired and revoked sessions without reading products", async () => {
    const expired = await createSessionCodec(secret, () => now - 8 * 86400000).create();
    for (const token of ["forged", expired, await createSessionCodec(secret, () => now).create({ credentialVersion: 2 })]) {
      const app = setup();
      expect((await app.run(await request("/api/admin/products", token)))?.status).toBe(401);
      expect(app.reads()).toBe(0);
    }
  });
  it("fails closed on version or data outage and never leaks upstream details", async () => {
    for (const port of ["credentialVersion", "readProducts"] as const) {
      const app = setup();
      app.ports[port] = async () => { throw new Error("private-key-detail"); };
      const response = await app.run(await request("/api/admin/products"));
      expect(response?.status).toBe(503);
      expect(await response?.text()).not.toContain("private-key-detail");
      if (port === "credentialVersion") expect(app.reads()).toBe(0);
    }
  });
  it.each(["POST", "PATCH", "DELETE"])("does not allow %s", async (method) => {
    const app = setup();
    const response = await app.run(await request("/api/admin/products", undefined, method));
    expect(response?.status).toBe(405);
    expect(app.reads()).toBe(0);
  });
});
