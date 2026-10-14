import { describe, expect, it, vi } from "vitest";

const BINDINGS = {
  SUPABASE_URL: "http://127.0.0.1:55421",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
  ADMIN_SUPABASE_KEY: "sb_secret_local_test",
  ADMIN_AUTH_EMAIL: "local-admin@example.invalid",
  ADMIN_AUTH_USER_ID: "11111111-1111-4111-8111-111111111111",
};

const authSession = {
  access_token: "private-access-token",
  refresh_token: "private-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  user: { id: BINDINGS.ADMIN_AUTH_USER_ID, email: BINDINGS.ADMIN_AUTH_EMAIL },
};

describe("private Worker Supabase ports", () => {
  it("uses server key only for atomic reservation and completion", async () => {
    const { createSupabaseAdminPorts } = await import("@/cloudflare/admin/supabase-ports");
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      if (url.pathname.endsWith("begin_admin_auth_attempt")) {
        return Response.json([{ out_allowed: true, out_retry_after: 0, out_reservation_id: "reservation-1" }]);
      }
      return Response.json(0);
    }) as typeof fetch;
    const ports = createSupabaseAdminPorts(BINDINGS, fetcher);

    expect(await ports.reserve("a".repeat(64))).toEqual({ allowed: true, retryAfter: 0, reservationId: "reservation-1" });
    expect(await ports.finish("reservation-1", false)).toBe(0);
    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/rest/v1/rpc/begin_admin_auth_attempt",
      "/rest/v1/rpc/finish_admin_auth_attempt",
    ]);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      p_key_hash: "a".repeat(64), p_scope: "login", p_ttl_seconds: 30, p_max_concurrent: 3,
    });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      p_reservation_id: "reservation-1", p_password_is_valid: false,
    });
    for (const call of calls) {
      const headers = new Headers(call.init.headers);
      expect(headers.get("apikey")).toBe(BINDINGS.ADMIN_SUPABASE_KEY);
      expect(headers.get("authorization")).toBeNull();
      expect(JSON.stringify(call)).not.toContain(BINDINGS.SUPABASE_PUBLISHABLE_KEY);
    }
  });

  it("uses publishable key and a fixed identity to verify password, without retaining Auth tokens", async () => {
    const { createSupabaseAdminPorts } = await import("@/cloudflare/admin/supabase-ports");
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      calls.push({ url: new URL(String(input)), init });
      return Response.json(authSession);
    }) as typeof fetch;
    const ports = createSupabaseAdminPorts(BINDINGS, fetcher);

    expect(await ports.verifyPassword("test-password")).toBe(true);
    expect(await ports.verifyPassword("test-password")).toBe(true);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(`${call.url.pathname}${call.url.search}`).toBe("/auth/v1/token?grant_type=password");
      expect(new Headers(call.init.headers).get("apikey")).toBe(BINDINGS.SUPABASE_PUBLISHABLE_KEY);
      expect(new Headers(call.init.headers).get("authorization")).toBeNull();
      expect(JSON.parse(String(call.init.body))).toEqual({ email: BINDINGS.ADMIN_AUTH_EMAIL, password: "test-password" });
      expect(JSON.stringify(call)).not.toContain(BINDINGS.ADMIN_SUPABASE_KEY);
    }
  });

  it("rejects a successful sign-in for a different user ID", async () => {
    const { createSupabaseAdminPorts } = await import("@/cloudflare/admin/supabase-ports");
    const fetcher = vi.fn(async () => Response.json({ ...authSession, user: { ...authSession.user, id: "other-user" } })) as typeof fetch;
    expect(await createSupabaseAdminPorts(BINDINGS, fetcher).verifyPassword("test-password")).toBe(false);
  });

  it("treats only the Auth invalid_credentials code as a wrong password", async () => {
    const { createSupabaseAdminPorts } = await import("@/cloudflare/admin/supabase-ports");
    const wrongPassword = vi.fn(async () => Response.json({ code: "invalid_credentials", msg: "bad" }, { status: 400 })) as typeof fetch;
    const outage = vi.fn(async () => Response.json({ code: "unexpected_failure", msg: "private details" }, { status: 500 })) as typeof fetch;
    expect(await createSupabaseAdminPorts(BINDINGS, wrongPassword).verifyPassword("nope")).toBe(false);
    await expect(createSupabaseAdminPorts(BINDINGS, outage).verifyPassword("nope")).rejects.toThrow("Admin verifier unavailable");
  });

  it("reads the current credential version and defaults only an empty result to one", async () => {
    const { createSupabaseAdminPorts } = await import("@/cloudflare/admin/supabase-ports");
    const urls: URL[] = [];
    let rows: unknown = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      urls.push(new URL(String(input)));
      return Response.json(rows);
    }) as typeof fetch;
    const ports = createSupabaseAdminPorts(BINDINGS, fetcher);
    expect(await ports.credentialVersion()).toBe(1);
    rows = [{ session_version: 4 }];
    expect(await ports.credentialVersion()).toBe(4);
    expect(urls[0].pathname).toBe("/rest/v1/admin_credentials");
    expect(urls[0].searchParams.get("credential_key")).toBe("eq.primary");
    expect(urls[0].searchParams.get("select")).toBe("session_version");
  });

  it("fails closed on RPC or version errors and malformed success payloads", async () => {
    const { createSupabaseAdminPorts } = await import("@/cloudflare/admin/supabase-ports");
    const error = vi.fn(async () => Response.json({ code: "PGRST202" }, { status: 404 })) as typeof fetch;
    await expect(createSupabaseAdminPorts(BINDINGS, error).reserve("a".repeat(64))).rejects.toThrow("Admin protection unavailable");
    await expect(createSupabaseAdminPorts(BINDINGS, error).credentialVersion()).rejects.toThrow("Admin protection unavailable");
    const malformed = vi.fn(async () => Response.json([{ session_version: "4" }])) as typeof fetch;
    await expect(createSupabaseAdminPorts(BINDINGS, malformed).credentialVersion()).rejects.toThrow("Admin protection unavailable");
  });

  it("supports a legacy local JWT only on the private RPC channel", async () => {
    const { createSupabaseAdminPorts } = await import("@/cloudflare/admin/supabase-ports");
    const fetcher = vi.fn(async (_: string | URL | Request, init: RequestInit = {}) => {
      expect(new Headers(init.headers).get("apikey")).toBe("eyJ.local.legacy");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer eyJ.local.legacy");
      return Response.json(0);
    }) as typeof fetch;
    await createSupabaseAdminPorts({ ...BINDINGS, ADMIN_SUPABASE_KEY: "eyJ.local.legacy" }, fetcher).finish("reservation-1", false);
  });
});
