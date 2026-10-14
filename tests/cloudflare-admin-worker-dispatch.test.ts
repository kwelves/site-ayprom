import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionCodec } from "@/lib/admin/session-codec";
import { FIXTURE_ENV_PASSWORD, GOLDEN_HASH_PASSWORD, GOLDEN_PBKDF2_HASH } from "./support/legacy-password-verifier-fixtures";

afterEach(() => vi.unstubAllGlobals());

const ORIGIN = "https://example.test";
const SESSION_KEY = "worker-dispatch-fixture-session-secret-32-bytes";
const PUBLICATION_ID = "20000000-0000-4000-8000-000000000003";
const PUBLICATION_CAPABILITY = "worker-dispatch-local-publication-capability";
function legacyEnv(password?: string) {
  return {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    PUBLICATION_ID,
    PUBLICATION_CAPABILITY,
    ADMIN_SUPABASE_KEY: "sb_secret_fake14",
    ADMIN_COOKIE_HMAC_KEY: SESSION_KEY,
    ADMIN_CRYPTO_KEY: "local-only-dispatch-crypto-secret-123456",
    ADMIN_PASSWORD: password,
    ASSETS: { fetch: async () => new Response("<h1>fixture</h1>", { headers: { "content-type": "text/html" } }) },
  };
}
function backendFixture(rows: unknown, readStatus = 200) {
  const calls: { path: string; key: string | null; body: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, key: new Headers(init?.headers).get("apikey"), body: String(init?.body ?? "") });
    if (path.endsWith("/begin_admin_auth_attempt")) return Response.json([{ out_allowed: true, out_retry_after: 0, out_reservation_id: "fixture-reservation" }]);
    if (path.endsWith("/finish_admin_auth_attempt")) return Response.json(0);
    if (path === "/rest/v1/admin_credentials") return Response.json(rows, { status: readStatus });
    if (path === "/functions/v1/admin-password-crypto") {
      const body = JSON.parse(String(init?.body)) as { password: string };
      return Response.json({ valid: body.password === GOLDEN_HASH_PASSWORD });
    }
    if (path.endsWith("/search_catalog_products")) return new Response("[]", { headers: { "content-type": "application/json", "content-range": "*/0" } });
    throw new Error("unexpected fixture request");
  }));
  return calls;
}
function login(password: string) {
  return new Request(`${ORIGIN}/api/admin/login`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password }),
  });
}

describe("thin Worker legacy password wiring", () => {
  it.each([
    { label: "empty row and env", rows: [], password: FIXTURE_ENV_PASSWORD, envPassword: FIXTURE_ENV_PASSWORD, version: 1 },
    { label: "hash without env", rows: [{ password_hash: GOLDEN_PBKDF2_HASH, session_version: 3 }], password: GOLDEN_HASH_PASSWORD, envPassword: undefined, version: 3 },
  ])("logs in using $label without email, user id or GoTrue", async ({ rows, password, envPassword, version }) => {
    const calls = backendFixture(rows);
    const env = legacyEnv(envPassword);
    const worker = (await import("@/cloudflare/worker")).default;
    const response = await worker.fetch(login(password), env);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/admin");
    const token = /admin_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
    expect(token).toBeTruthy();
    expect((await createSessionCodec(SESSION_KEY, Date.now).read(token))?.credentialVersion).toBe(version);
    expect(calls.map((c) => c.path)).toEqual([
      "/rest/v1/rpc/begin_admin_auth_attempt", "/rest/v1/admin_credentials",
      ...(version > 1 ? ["/functions/v1/admin-password-crypto"] : []),
      "/rest/v1/rpc/finish_admin_auth_attempt", "/rest/v1/admin_credentials",
    ]);
    expect(calls.every((c) => c.key === (c.path.startsWith("/functions/") ? env.SUPABASE_PUBLISHABLE_KEY : env.ADMIN_SUPABASE_KEY)
      && !c.body.includes(env.ADMIN_SUPABASE_KEY))).toBe(true);
  });

  it("does not fall back to env when credential reads fail", async () => {
    const calls = backendFixture({ message: "fixture outage" }, 503);
    const worker = (await import("@/cloudflare/worker")).default;
    const response = await worker.fetch(login(FIXTURE_ENV_PASSWORD), legacyEnv(FIXTURE_ENV_PASSWORD));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/admin/login?error=security");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(calls.filter((c) => c.path.endsWith("/finish_admin_auth_attempt"))).toHaveLength(1);
  });

  it("keeps the private key out of public search even when admin is configured", async () => {
    const calls = backendFixture([]);
    const worker = (await import("@/cloudflare/worker")).default;
    const response = await worker.fetch(new Request(`${ORIGIN}/api/catalog/search`), legacyEnv());
    expect(response.status).toBe(200);
    expect(calls).toEqual([{ path: "/rest/v1/rpc/search_catalog_products", key: "sb_publishable_test", body: expect.any(String) }]);
    expect(JSON.parse(calls[0].body)).toMatchObject({
      publication_id: PUBLICATION_ID,
      publication_capability: PUBLICATION_CAPABILITY,
    });
  });
});

describe("thin Worker dispatch without admin bindings", () => {
  it("preserves public health and denies admin configuration fail-closed", async () => {
    const worker = (await import("@/cloudflare/worker")).default;
    const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" } as Env;
    const health = await worker.fetch(new Request("https://example.test/api/health"), env);
    const admin = await worker.fetch(new Request("https://example.test/admin"), env);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect(admin.status).toBe(503);
    expect(admin.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps public catalog search on the publishable RPC when admin bindings are absent", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json", "content-range": "*/0" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const worker = (await import("@/cloudflare/worker")).default;
    const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      PUBLICATION_ID, PUBLICATION_CAPABILITY } as Env;
    const response = await worker.fetch(new Request("https://example.test/api/catalog/search?q=none"), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: [], total: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toContain("/rest/v1/rpc/search_catalog_products");
    expect(new Headers(init.headers).get("apikey")).toBe("sb_publishable_test");
    expect(new Headers(init.headers).get("authorization")).toBeNull();
    expect(JSON.parse(String(init.body))).toMatchObject({
      publication_id: PUBLICATION_ID,
      publication_capability: PUBLICATION_CAPABILITY,
    });
  });
});

describe("thin Worker product edit wiring", () => {
  const productRow = {
    id: "4d331dcf-4243-4a29-aacd-93c30af433e6", slug: "pump", name: "Pump", category_slug: "hydraulic-pumps",
    short_description: "", description: null, article: null, published: false, availability: "in_stock",
    meta_title: null, meta_description: null, updated_at: "2026-10-04T08:00:00.123456+00:00", subcategories: null,
    product_characteristics: [], product_brands: [], product_vehicle_types: [], vehicle_hotspots: [],
  };

  it("reads one draft for a current session but never wires a product write", async () => {
    const calls: { path: string; key: string | null; method: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      calls.push({ path, key: new Headers(init?.headers).get("apikey"), method: init?.method ?? "GET" });
      if (path === "/rest/v1/admin_credentials") return Response.json([]);
      if (path === "/rest/v1/products") return Response.json([productRow]);
      throw new Error("unexpected fixture request");
    }));
    const worker = (await import("@/cloudflare/worker")).default;
    const env = legacyEnv(FIXTURE_ENV_PASSWORD) as unknown as Env;
    const cookie = `admin_session=${await createSessionCodec(SESSION_KEY, Date.now).create({ credentialVersion: 1 })}`;

    const read = await worker.fetch(new Request(`${ORIGIN}/api/admin/products/pump`, { headers: { cookie } }), env);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ slug: "pump", updatedAt: productRow.updated_at, published: false });
    expect(calls.filter((call) => call.path === "/rest/v1/products")).toEqual([
      { path: "/rest/v1/products", key: "sb_secret_fake14", method: "GET" },
    ]);

    const page = await worker.fetch(new Request(`${ORIGIN}/admin/products/pump/edit`, { headers: { cookie } }), env);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<fieldset disabled>");

    const put = await worker.fetch(new Request(`${ORIGIN}/api/admin/products/pump`, {
      method: "PUT", headers: { origin: ORIGIN, cookie, "content-type": "application/json" }, body: "{}",
    }), env);
    expect(put.status).toBe(404);
    const form = await worker.fetch(new Request(`${ORIGIN}/admin/products/pump/edit`, {
      method: "POST", headers: { origin: ORIGIN, cookie, "content-type": "application/x-www-form-urlencoded" }, body: "name=x",
    }), env);
    expect(form.status).toBe(503);
    expect(await form.text()).toContain("Сохранение отключено");
    expect(calls.some((call) => call.path.startsWith("/rest/v1/rpc/"))).toBe(false);
  });
});
