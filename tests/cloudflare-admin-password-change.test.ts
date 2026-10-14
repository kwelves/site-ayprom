import { describe, expect, it, vi } from "vitest";
import { createAdminHandler } from "@/cloudflare/admin/handler";
import type { AdminAuthPorts } from "@/cloudflare/admin/contracts";
import { createSessionCodec } from "@/lib/admin/session-codec";

const ORIGIN = "https://www.ayprom-gidravlika.kg";
const SECRET = "worker-admin-cookie-local-test-secret-32-bytes";
const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const OLD = "old-admin-password-123";
const NEW = "new-admin-password-456";

function ports(events: string[]): AdminAuthPorts {
  return {
    reserve: vi.fn(async (_key, scope) => { events.push(`reserve:${scope}`); return { allowed: true, retryAfter: 0, reservationId: "r1" }; }),
    finish: vi.fn(async (_id, valid) => { events.push(`finish:${valid}`); return 0; }),
    verifyPassword: vi.fn(async () => { throw new Error("must use proof"); }),
    verifyPasswordWithVersion: vi.fn(async (password: string) => { events.push("verify"); return password === OLD ? { valid: true as const, credentialVersion: 2 } : { valid: false as const }; }),
    credentialVersion: vi.fn(async () => { events.push("version"); return 2; }),
    hashPassword: vi.fn(async () => { events.push("hash"); return "pbkdf2-sha256:600000:fixture:fixture"; }),
    replacePasswordHash: vi.fn(async () => { events.push("write"); return 3; }),
    assets: { fetch: vi.fn(async () => new Response("<h1>Protected</h1>", { headers: { "content-type": "text/html" } })) },
    secret: SECRET,
    clientIp: "203.0.113.20",
    now: () => NOW,
  };
}

async function post(cookie: string | null, fields: Record<string, string>, origin = ORIGIN) {
  return new Request(`${ORIGIN}/api/admin/password`, {
    method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams(fields),
  });
}

async function token(version = 2) {
  return `admin_session=${await createSessionCodec(SECRET, () => NOW).create({ credentialVersion: version })}`;
}

const fields = { currentPassword: OLD, newPassword: NEW, confirmPassword: NEW };

describe("Cloudflare admin password change keeps legacy behavior", () => {
  it("shows a clear confirmation on the login page after a successful password change", async () => {
    const p = ports([]);
    p.assets.fetch = vi.fn(async () => new Response("<p role=\"alert\"><!-- AUTH_MESSAGE --></p>", {
      headers: { "content-type": "text/html" },
    }));
    const response = await createAdminHandler(p)(new Request(`${ORIGIN}/admin/login?changed=1`));
    expect(response?.status).toBe(200);
    expect(await response?.text()).toContain("Пароль изменён");
  });

  it("verifies the current password, writes version 3, clears the session, and rejects its old cookie", async () => {
    const events: string[] = [];
    const p = ports(events);
    const handler = createAdminHandler(p);
    const cookie = await token();
    const changed = await handler(await post(cookie, fields));
    expect(changed?.status).toBe(303);
    expect(changed?.headers.get("location")).toBe("/admin/login?changed=1");
    expect(changed?.headers.get("set-cookie")).toContain("admin_session=; Max-Age=0");
    expect(events).toEqual(["version", "reserve:password-change", "verify", "finish:true", "hash", "write"]);
    expect(p.replacePasswordHash).toHaveBeenCalledWith("pbkdf2-sha256:600000:fixture:fixture", 2);
    vi.mocked(p.credentialVersion).mockResolvedValue(3);
    const old = await handler(new Request(`${ORIGIN}/admin`, { headers: { cookie } }));
    expect(old?.headers.get("location")).toBe("/admin/login?session=expired");
  });

  it("rejects guests and stale sessions before reading a password or writing", async () => {
    for (const cookie of [null, await token(1)]) {
      const p = ports([]);
      const response = await createAdminHandler(p)(await post(cookie, fields));
      expect(response?.headers.get("location")).toMatch(/^\/admin\/login/);
      expect(p.reserve).not.toHaveBeenCalled();
      expect(p.hashPassword).not.toHaveBeenCalled();
      expect(p.replacePasswordHash).not.toHaveBeenCalled();
    }
  });

  it("rejects wrong Origin, malformed form, same password and short replacement", async () => {
    for (const request of [
      await post(await token(), fields, "https://attacker.invalid"),
      await post(await token(), { ...fields, extra: "1" }),
      await post(await token(), { ...fields, newPassword: OLD, confirmPassword: OLD }),
      await post(await token(), { ...fields, newPassword: "short", confirmPassword: "short" }),
    ]) {
      const p = ports([]);
      const response = await createAdminHandler(p)(request);
      expect(response?.status).not.toBe(200);
      expect(p.hashPassword).not.toHaveBeenCalled();
      expect(p.replacePasswordHash).not.toHaveBeenCalled();
    }
  });

  it("counts a wrong current password as a failed reserved attempt, without writing", async () => {
    const p = ports([]);
    const response = await createAdminHandler(p)(await post(await token(), { ...fields, currentPassword: "wrong" }));
    expect(response?.headers.get("location")).toBe("/admin/security?error=1");
    expect(p.finish).toHaveBeenCalledWith("r1", false);
    expect(p.hashPassword).not.toHaveBeenCalled();
  });

  it("fails closed if remote hash computation or compare-and-set write fails", async () => {
    for (const broken of ["hashPassword", "replacePasswordHash"] as const) {
      const p = ports([]);
      p[broken] = vi.fn(async () => { throw new Error("backend secret detail"); });
      const response = await createAdminHandler(p)(await post(await token(), fields));
      expect(response?.headers.get("location")).toBe("/admin/security?error=security");
      expect(response?.headers.get("set-cookie")).toBeNull();
      expect(await response?.text()).not.toContain("secret detail");
    }
  });
});
