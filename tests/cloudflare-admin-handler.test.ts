import { describe, expect, it, vi } from "vitest";
import type { AdminAuthPorts } from "@/cloudflare/admin/contracts";
import { createSessionCodec } from "@/lib/admin/session-codec";

const ORIGIN = "https://www.ayprom-gidravlika.kg";
const SECRET = "worker-admin-cookie-local-test-secret-32-bytes";
const NOW = Date.parse("2026-09-27T12:00:00.000Z");

function loginRequest(password = "valid", headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/admin/login`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams({ password }),
  });
}

function makePorts(events: string[] = []): AdminAuthPorts {
  return {
    reserve: vi.fn(async () => {
      events.push("reserve");
      return { allowed: true, retryAfter: 0, reservationId: "reservation-1" };
    }),
    verifyPassword: vi.fn(async () => {
      events.push("verify");
      return true;
    }),
    finish: vi.fn(async () => {
      events.push("finish");
      return 0;
    }),
    credentialVersion: vi.fn(async () => {
      events.push("version");
      return 1;
    }),
    assets: { fetch: vi.fn(async () => new Response("fixture")) },
    secret: SECRET,
    clientIp: "203.0.113.20",
    now: () => NOW,
  };
}

describe("thin Worker admin login", () => {
  it("reserves before verifying and finishing, then issues a legacy-readable secure cookie", async () => {
    const { createAdminHandler } = await import("@/cloudflare/admin/handler");
    const events: string[] = [];
    const ports = makePorts(events);
    const response = await createAdminHandler(ports)(loginRequest());
    expect(response?.status).toBe(303);
    expect(response?.headers.get("location")).toBe("/admin");
    expect(events).toEqual(["reserve", "verify", "finish", "version"]);
    const cookie = response?.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("admin_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=604800");
    const token = cookie.match(/admin_session=([^;]+)/)?.[1];
    expect((await createSessionCodec(SECRET, () => NOW).read(token))?.credentialVersion).toBe(1);
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it("never checks the password when reservation is denied", async () => {
    const { createAdminHandler } = await import("@/cloudflare/admin/handler");
    const ports = makePorts();
    ports.reserve = vi.fn(async () => ({ allowed: false, retryAfter: 47, reservationId: null }));
    const response = await createAdminHandler(ports)(loginRequest());
    expect(response?.status).toBe(303);
    expect(response?.headers.get("location")).toBe("/admin/login?error=rate&retry=47");
    expect(ports.verifyPassword).not.toHaveBeenCalled();
    expect(response?.headers.has("set-cookie")).toBe(false);
  });

  it("records a wrong password and redirects without a session", async () => {
    const { createAdminHandler } = await import("@/cloudflare/admin/handler");
    const ports = makePorts();
    ports.verifyPassword = vi.fn(async () => false);
    const response = await createAdminHandler(ports)(loginRequest("wrong"));
    expect(response?.status).toBe(303);
    expect(response?.headers.get("location")).toBe("/admin/login?error=1");
    expect(ports.finish).toHaveBeenCalledWith("reservation-1", false);
    expect(response?.headers.has("set-cookie")).toBe(false);
  });

  it("finishes the reservation as failed after verifier outage", async () => {
    const { createAdminHandler } = await import("@/cloudflare/admin/handler");
    const ports = makePorts();
    ports.verifyPassword = vi.fn(async () => { throw new Error("upstream password and tokens"); });
    const response = await createAdminHandler(ports)(loginRequest());
    expect(response?.headers.get("location")).toBe("/admin/login?error=security");
    expect(ports.finish).toHaveBeenCalledWith("reservation-1", false);
    expect(response?.headers.has("set-cookie")).toBe(false);
    expect(await response?.text()).not.toContain("upstream");
  });

  it("fails closed when reservation, finish, or version lookup fails", async () => {
    const { createAdminHandler } = await import("@/cloudflare/admin/handler");
    for (const brokenPort of ["reserve", "finish", "credentialVersion"] as const) {
      const ports = makePorts();
      ports[brokenPort] = vi.fn(async () => { throw new Error("private upstream detail"); }) as never;
      const response = await createAdminHandler(ports)(loginRequest());
      expect(response?.status).toBe(303);
      expect(response?.headers.get("location")).toBe("/admin/login?error=security");
      expect(response?.headers.has("set-cookie")).toBe(false);
      expect(JSON.stringify([...response!.headers])).not.toContain("private upstream detail");
    }
  });

  it("rejects foreign Origin and malformed form before all auth ports", async () => {
    const { createAdminHandler } = await import("@/cloudflare/admin/handler");
    for (const request of [
      loginRequest("valid", { origin: "https://attacker.example" }),
      loginRequest("valid", { origin: "" }),
      new Request(`${ORIGIN}/api/admin/login`, {
        method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
        body: "password=one&password=two",
      }),
    ]) {
      const ports = makePorts();
      const response = await createAdminHandler(ports)(request);
      expect(response?.status).toBe(400);
      expect(ports.reserve).not.toHaveBeenCalled();
      expect(ports.verifyPassword).not.toHaveBeenCalled();
      expect(response?.headers.has("set-cookie")).toBe(false);
    }
  });

  it("rejects unsupported login method and body type without auth work", async () => {
    const { createAdminHandler } = await import("@/cloudflare/admin/handler");
    const ports = makePorts();
    const get = await createAdminHandler(ports)(new Request(`${ORIGIN}/api/admin/login`));
    const json = await createAdminHandler(ports)(loginRequest("valid", { "content-type": "application/json" }));
    expect(get?.status).toBe(405);
    expect(json?.status).toBe(400);
    expect(ports.reserve).not.toHaveBeenCalled();
  });

  it("uses the injected trusted IP, not spoofed forwarding headers, for the reservation key", async () => {
    const { createAdminHandler } = await import("@/cloudflare/admin/handler");
    const ports = makePorts();
    await createAdminHandler(ports)(loginRequest("wrong", { "x-forwarded-for": "1.1.1.1" }));
    await createAdminHandler(ports)(loginRequest("wrong", { "x-forwarded-for": "2.2.2.2" }));
    const calls = vi.mocked(ports.reserve).mock.calls;
    expect(calls[0][0]).toMatch(/^[0-9a-f]{64}$/);
    // Independent HMAC-SHA256 golden value for key SECRET and message "login:203.0.113.20".
    expect(calls[0][0]).toBe("42fc22b99d665d7c8f75618f9622559b4471319ac5744d25dcb5aa8344572faa");
    expect(calls[1][0]).toBe(calls[0][0]);
  });

  it("returns null outside admin routes", async () => {
    const { createAdminHandler } = await import("@/cloudflare/admin/handler");
    expect(await createAdminHandler(makePorts())(new Request(`${ORIGIN}/api/catalog/search`))).toBeNull();
  });
});

describe("thin Worker admin logout", () => {
  it("clears the cookie only for a same-origin POST", async () => {
    const { createAdminHandler } = await import("@/cloudflare/admin/handler");
    const ports = makePorts();
    const handler = createAdminHandler(ports);
    const response = await handler(new Request(`${ORIGIN}/api/admin/logout`, { method: "POST", headers: { origin: ORIGIN } }));
    expect(response?.status).toBe(303);
    expect(response?.headers.get("location")).toBe("/admin/login");
    expect(response?.headers.get("set-cookie")).toContain("admin_session=; Max-Age=0");
    const foreign = await handler(new Request(`${ORIGIN}/api/admin/logout`, { method: "POST", headers: { origin: "https://attacker.example" } }));
    expect(foreign?.status).toBe(400);
    expect(foreign?.headers.has("set-cookie")).toBe(false);
  });
});

describe("thin Worker admin asset gate", () => {
  it("renders only allowlisted login errors and bounded retry text", async () => {
    const { createAdminHandler } = await import("@/cloudflare/admin/handler");
    const ports = makePorts();
    ports.assets.fetch = vi.fn(async () => new Response("<p><!-- AUTH_MESSAGE --></p>", {
      headers: { "content-type": "text/html" },
    }));
    const handler = createAdminHandler(ports);
    const hostile = await handler(new Request(`${ORIGIN}/admin/login?error=%3Cscript%3E&retry=%3Cimg%3E`));
    const retry = await handler(new Request(`${ORIGIN}/admin/login?error=rate&retry=999999`));
    expect(await hostile?.text()).toBe("<p></p>");
    expect(await retry?.text()).toContain("15 минут");
    expect(retry?.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed if an allowlisted HTML asset is absent", async () => {
    const { createAdminHandler } = await import("@/cloudflare/admin/handler");
    const ports = makePorts();
    ports.assets.fetch = vi.fn(async () => new Response("missing", { status: 404 }));
    const response = await createAdminHandler(ports)(new Request(`${ORIGIN}/admin/login`));
    expect(response?.status).toBe(503);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(await response?.text()).not.toContain("missing");
  });
  it("redirects a guest before any protected asset is fetched", async () => {
    const { createAdminHandler } = await import("@/cloudflare/admin/handler");
    const ports = makePorts();
    const response = await createAdminHandler(ports)(new Request(`${ORIGIN}/admin`));
    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe("/admin/login");
    expect(ports.assets.fetch).not.toHaveBeenCalled();
  });

  it("serves only the allowlisted shell after HMAC and version checks", async () => {
    const { createAdminHandler } = await import("@/cloudflare/admin/handler");
    const ports = makePorts();
    ports.assets.fetch = vi.fn(async () => new Response("<h1>Local admin shell</h1>", {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" },
    }));
    const token = await createSessionCodec(SECRET, () => NOW).create({ credentialVersion: 1 });
    const response = await createAdminHandler(ports)(new Request(`${ORIGIN}/admin`, {
      headers: { cookie: `admin_session=${token}` },
    }));
    expect(response?.status).toBe(200);
    expect(await response?.text()).toContain("Local admin shell");
    expect(vi.mocked(ports.assets.fetch).mock.calls[0][0].url).toBe(`${ORIGIN}/admin/index.html`);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response?.headers.get("content-security-policy")).toContain("form-action 'self'");
  });

  it("rejects tampered, expired, and old-version cookies without fetching assets", async () => {
    const { createAdminHandler } = await import("@/cloudflare/admin/handler");
    const ports = makePorts();
    const codec = createSessionCodec(SECRET, () => NOW);
    const valid = await codec.create();
    const expired = await createSessionCodec(SECRET, () => NOW - 8 * 24 * 60 * 60 * 1000).create();
    const oldVersion = await codec.create({ credentialVersion: 1 });
    ports.credentialVersion = vi.fn(async () => 2);
    for (const [token, location] of [
      [`${valid}tampered`, "/admin/login"],
      [expired, "/admin/login"],
      [oldVersion, "/admin/login?session=expired"],
    ]) {
      const response = await createAdminHandler(ports)(new Request(`${ORIGIN}/admin`, {
        headers: { cookie: `admin_session=${token}` },
      }));
      expect(response?.status).toBe(302);
      expect(response?.headers.get("location")).toBe(location);
    }
    expect(ports.assets.fetch).not.toHaveBeenCalled();
  });

  it("fails closed when the credential-version backend is unavailable", async () => {
    const { createAdminHandler } = await import("@/cloudflare/admin/handler");
    const ports = makePorts();
    ports.credentialVersion = vi.fn(async () => { throw new Error("upstream private error"); });
    const token = await createSessionCodec(SECRET, () => NOW).create();
    const response = await createAdminHandler(ports)(new Request(`${ORIGIN}/admin`, {
      headers: { cookie: `admin_session=${token}` },
    }));
    expect(response?.headers.get("location")).toBe("/admin/login?session=unavailable");
    expect(response?.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(ports.assets.fetch).not.toHaveBeenCalled();
  });

  it("refreshes a session in its final hour without resetting the absolute issue time", async () => {
    const { createAdminHandler } = await import("@/cloudflare/admin/handler");
    const ports = makePorts();
    ports.assets.fetch = vi.fn(async () => new Response("<h1>Local admin shell</h1>", {
      headers: { "content-type": "text/html" },
    }));
    const original = NOW - (7 * 24 * 60 * 60 - 30 * 60) * 1000;
    const token = await createSessionCodec(SECRET, () => original).create();
    const response = await createAdminHandler(ports)(new Request(`${ORIGIN}/admin`, {
      headers: { cookie: `admin_session=${token}` },
    }));
    const refreshed = response?.headers.get("set-cookie")?.match(/admin_session=([^;]+)/)?.[1];
    expect((await createSessionCodec(SECRET, () => NOW).read(refreshed))?.iat).toBe(original);
    expect(refreshed).not.toBe(token);
  });

  it("serves the guest login page, but denies direct source filenames and unknown admin paths", async () => {
    const { createAdminHandler } = await import("@/cloudflare/admin/handler");
    const ports = makePorts();
    ports.assets.fetch = vi.fn(async () => new Response("<h1>Login</h1>", { headers: { "content-type": "text/html" } }));
    const handler = createAdminHandler(ports);
    const login = await handler(new Request(`${ORIGIN}/admin/login`));
    expect(login?.status).toBe(200);
    expect(login?.headers.get("cache-control")).toBe("no-store");
    expect(vi.mocked(ports.assets.fetch).mock.calls[0][0].url).toBe(`${ORIGIN}/admin/login.html`);
    const direct = await handler(new Request(`${ORIGIN}/admin/login.html`));
    const unknownGuest = await handler(new Request(`${ORIGIN}/admin/not-implemented`));
    const token = await createSessionCodec(SECRET, () => NOW).create();
    const unknown = await handler(new Request(`${ORIGIN}/admin/not-implemented`, {
      headers: { cookie: `admin_session=${token}` },
    }));
    const api = await handler(new Request(`${ORIGIN}/api/admin/not-implemented`));
    expect(direct?.status).toBe(404);
    expect(unknownGuest?.headers.get("location")).toBe("/admin/login");
    expect(unknown?.status).toBe(404);
    expect(api?.status).toBe(404);
    expect(ports.assets.fetch).toHaveBeenCalledTimes(1);
  });
});
