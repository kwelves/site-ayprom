import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminHandler } from "@/cloudflare/admin/handler";
import { createAdminAttemptPorts, createSupabaseAdminPorts } from "@/cloudflare/admin/supabase-ports";
import { createLegacyAdminPorts } from "@/cloudflare/admin/legacy-admin-ports";
import { LegacyPasswordVerifierError } from "@/cloudflare/admin/legacy-password-verifier";
import { createSessionCodec } from "@/lib/admin/session-codec";
import {
  FIXTURE_ENV_PASSWORD,
  FIXTURE_WRONG_PASSWORD,
  GOLDEN_HASH_PASSWORD,
  GOLDEN_PBKDF2_HASH,
} from "./support/legacy-password-verifier-fixtures";

const URL_BASE = "http://127.0.0.1:55999";
const PRIVATE_KEY = "sb_secret_fake06";
const JWT_KEY = "eyJfixture.legacy.ports.jwt-not-real";
const BINDINGS = { SUPABASE_URL: URL_BASE, ADMIN_SUPABASE_KEY: PRIVATE_KEY, ADMIN_PASSWORD: FIXTURE_ENV_PASSWORD };
const CREDENTIAL_URL =
  `${URL_BASE}/rest/v1/admin_credentials?select=password_hash%2Csession_version&credential_key=eq.primary&limit=2`;
const ORIGIN = "https://www.ayprom-gidravlika.kg";
const SECRET = "worker-admin-cookie-local-test-secret-32-bytes";
const NOW = Date.parse("2026-09-30T12:00:00.000Z");

type Credentials =
  | { kind: "rows"; rows: unknown[] }
  | { kind: "status"; status: number; body: unknown }
  | { kind: "text"; text: string };

interface Backend {
  fetcher: typeof fetch;
  calls: { method: string; url: string; headers: Headers; body: string | null }[];
  credentials: Credentials;
}

function backend(credentials: Credentials): Backend {
  const state: Backend = {
    credentials,
    calls: [],
    fetcher: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      state.calls.push({
        method: init.method ?? "GET",
        url: String(input),
        headers: new Headers(init.headers),
        body: typeof init.body === "string" ? init.body : null,
      });
      if (url.pathname.endsWith("/begin_admin_auth_attempt")) {
        return Response.json([{ out_allowed: true, out_retry_after: 0, out_reservation_id: "reservation-1" }]);
      }
      if (url.pathname.endsWith("/finish_admin_auth_attempt")) return Response.json(0);
      if (url.pathname === "/rest/v1/admin_credentials") {
        const source = state.credentials;
        if (source.kind === "rows") return Response.json(source.rows);
        if (source.kind === "status") return Response.json(source.body, { status: source.status });
        return new Response(source.text, { status: 200 });
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch,
  };
  return state;
}

const HASH_ROW = (version: number) => ({ password_hash: GOLDEN_PBKDF2_HASH, session_version: version });
const paths = (b: Backend) => b.calls.map((call) => `${call.method} ${new URL(call.url).pathname}`);

async function rejection(promise: Promise<unknown>): Promise<Error> {
  return promise.then(() => { throw new Error("expected rejection"); }, (error: Error) => error);
}

afterEach(() => vi.restoreAllMocks());

describe("createAdminAttemptPorts: только SUPABASE_URL и ADMIN_SUPABASE_KEY", () => {
  it("те же два RPC, тела и заголовки, что у прежнего адаптера; ключ только в apikey", async () => {
    const legacy = backend({ kind: "rows", rows: [] });
    const attempt = backend({ kind: "rows", rows: [] });
    const previous = createSupabaseAdminPorts({
      SUPABASE_URL: URL_BASE, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", ADMIN_SUPABASE_KEY: PRIVATE_KEY,
      ADMIN_AUTH_EMAIL: "a@example.invalid", ADMIN_AUTH_USER_ID: "u",
    }, legacy.fetcher);
    const ports = createAdminAttemptPorts({ SUPABASE_URL: URL_BASE, ADMIN_SUPABASE_KEY: PRIVATE_KEY }, attempt.fetcher);

    const hash = "a".repeat(64);
    expect(await ports.reserve(hash)).toEqual(await previous.reserve(hash));
    expect(await ports.finish("reservation-1", true)).toBe(await previous.finish("reservation-1", true));

    expect(attempt.calls.map((c) => [c.method, c.url, c.body])).toEqual(legacy.calls.map((c) => [c.method, c.url, c.body]));
    expect(paths(attempt)).toEqual([
      "POST /rest/v1/rpc/begin_admin_auth_attempt",
      "POST /rest/v1/rpc/finish_admin_auth_attempt",
    ]);
    expect(JSON.parse(attempt.calls[0].body!)).toEqual({ p_key_hash: hash, p_scope: "login", p_ttl_seconds: 30, p_max_concurrent: 3 });
    expect(JSON.parse(attempt.calls[1].body!)).toEqual({ p_reservation_id: "reservation-1", p_password_is_valid: true });
    for (const call of attempt.calls) {
      expect(call.headers.get("apikey")).toBe(PRIVATE_KEY);
      expect(call.headers.get("authorization")).toBeNull();
      expect(call.url).not.toContain(PRIVATE_KEY);
    }
  });

  it("legacy JWT-ключ дополнительно передаётся как Bearer", async () => {
    const b = backend({ kind: "rows", rows: [] });
    await createAdminAttemptPorts({ SUPABASE_URL: URL_BASE, ADMIN_SUPABASE_KEY: JWT_KEY }, b.fetcher).reserve("a".repeat(64));
    expect(b.calls[0].headers.get("authorization")).toBe(`Bearer ${JWT_KEY}`);
  });

  it.each([
    ["нет URL", { SUPABASE_URL: "", ADMIN_SUPABASE_KEY: PRIVATE_KEY }],
    ["нет ключа", { SUPABASE_URL: URL_BASE, ADMIN_SUPABASE_KEY: "" }],
    ["ключ из пробелов", { SUPABASE_URL: URL_BASE, ADMIN_SUPABASE_KEY: "   " }],
    ["не-ASCII ключ", { SUPABASE_URL: URL_BASE, ADMIN_SUPABASE_KEY: "sb_secret_ключ" }],
    ["ключ с переводом строки", { SUPABASE_URL: URL_BASE, ADMIN_SUPABASE_KEY: "sb_secret_a\nX: 1" }],
  ])("невалидные bindings (%s) отклоняются фиксированной ошибкой до fetch", (_label, bindings) => {
    const b = backend({ kind: "rows", rows: [] });
    let thrown: Error | null = null;
    try {
      createAdminAttemptPorts(bindings, b.fetcher);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).toBe("Admin protection unavailable");
    expect(b.calls).toHaveLength(0);
  });

  it("прежний адаптер с не-ASCII ключом теперь тоже отвечает фиксированной ошибкой, а не сырым TypeError", () => {
    expect(() => createSupabaseAdminPorts({
      SUPABASE_URL: URL_BASE, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", ADMIN_SUPABASE_KEY: "sb_secret_ключ",
      ADMIN_AUTH_EMAIL: "a@example.invalid", ADMIN_AUTH_USER_ID: "u",
    }, backend({ kind: "rows", rows: [] }).fetcher)).toThrow("Admin protection unavailable");
  });

  it.each([
    ["схема ftp", "ftp://127.0.0.1:1"],
    ["userinfo", "http://u:p@127.0.0.1:1"],
    ["непарсируемый", "not a url"],
  ])("небезопасный SUPABASE_URL (%s): RPC отказывает без fetch, ключ не утекает", async (_label, url) => {
    const b = backend({ kind: "rows", rows: [] });
    const ports = createAdminAttemptPorts({ SUPABASE_URL: url, ADMIN_SUPABASE_KEY: PRIVATE_KEY }, b.fetcher);
    const error = await rejection(ports.reserve("a".repeat(64)));
    expect(error.message).toBe("Admin protection unavailable");
    expect(`${error.message} ${String(error)}`).not.toContain(PRIVATE_KEY);
    expect(b.calls).toHaveLength(0);
  });
});

describe("createLegacyAdminPorts: композиция без Supabase Auth", () => {
  it("при настроенной функции Supabase выносит PBKDF2 за пределы Worker и сохраняет version proof", async () => {
    const b = backend({ kind: "rows", rows: [HASH_ROW(3)] });
    const cryptoCalls: { url: string; body: unknown }[] = [];
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(url)).pathname === "/functions/v1/admin-password-crypto") {
        const body = JSON.parse(String(init?.body)) as { password: string };
        cryptoCalls.push({ url: String(url), body });
        return Response.json({ valid: body.password === GOLDEN_HASH_PASSWORD });
      }
      return b.fetcher(url, init);
    }) as typeof fetch;
    const ports = createLegacyAdminPorts({ ...BINDINGS,
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
      ADMIN_CRYPTO_KEY: "local-only-crypto-secret-with-enough-entropy-123456",
    }, fetcher);
    await expect(ports.verifyPasswordWithVersion(GOLDEN_HASH_PASSWORD)).resolves.toEqual({ valid: true, credentialVersion: 3 });
    expect(cryptoCalls).toHaveLength(1);
    expect(cryptoCalls[0].url).toBe(`${URL_BASE}/functions/v1/admin-password-crypto`);
    expect(paths(b)).toEqual(["GET /rest/v1/admin_credentials"]);
  });

  it("создаётся без ADMIN_AUTH_EMAIL / ADMIN_AUTH_USER_ID / публичного ключа и отдаёт все порты", async () => {
    const ports = createLegacyAdminPorts(BINDINGS, backend({ kind: "rows", rows: [] }).fetcher);
    expect(Object.keys(ports).sort()).toEqual(
      ["credentialVersion", "finish", "reserve", "verifyPassword", "verifyPasswordWithVersion"],
    );
  });

  it("пустая credential row: env-пароль → proof версии 1, чужой пароль → отказ", async () => {
    const b = backend({ kind: "rows", rows: [] });
    const ports = createLegacyAdminPorts(BINDINGS, b.fetcher);

    await expect(ports.verifyPasswordWithVersion(FIXTURE_ENV_PASSWORD)).resolves.toEqual({ valid: true, credentialVersion: 1 });
    await expect(ports.verifyPasswordWithVersion(FIXTURE_WRONG_PASSWORD)).resolves.toEqual({ valid: false });
    await expect(ports.verifyPassword(FIXTURE_ENV_PASSWORD)).resolves.toBe(true);
    await expect(ports.credentialVersion()).resolves.toBe(1);
  });

  it.each([2, 7])("строка с хешем версии %i: proof этой версии по хешу; env вместо хеша не подходит", async (version) => {
    const b = backend({ kind: "rows", rows: [HASH_ROW(version)] });
    const ports = createLegacyAdminPorts(BINDINGS, b.fetcher);

    await expect(ports.verifyPasswordWithVersion(GOLDEN_HASH_PASSWORD)).resolves.toEqual({ valid: true, credentialVersion: version });
    await expect(ports.verifyPasswordWithVersion(FIXTURE_ENV_PASSWORD)).resolves.toEqual({ valid: false });
    await expect(ports.verifyPassword(FIXTURE_ENV_PASSWORD)).resolves.toBe(false);
    await expect(ports.credentialVersion()).resolves.toBe(version);
  });

  it("hash-only состояние работает и без привязки ADMIN_PASSWORD", async () => {
    const ports = createLegacyAdminPorts(
      { SUPABASE_URL: URL_BASE, ADMIN_SUPABASE_KEY: PRIVATE_KEY },
      backend({ kind: "rows", rows: [HASH_ROW(2)] }).fetcher,
    );
    await expect(ports.verifyPasswordWithVersion(GOLDEN_HASH_PASSWORD)).resolves.toEqual({ valid: true, credentialVersion: 2 });
  });

  it("пустая строка без пригодного ADMIN_PASSWORD — отказ, а не вход", async () => {
    const ports = createLegacyAdminPorts(
      { SUPABASE_URL: URL_BASE, ADMIN_SUPABASE_KEY: PRIVATE_KEY },
      backend({ kind: "rows", rows: [] }).fetcher,
    );
    const error = await rejection(ports.verifyPasswordWithVersion("anything-long-enough"));
    expect(error).toBeInstanceOf(LegacyPasswordVerifierError);
    expect((error as LegacyPasswordVerifierError).code).toBe("env_password_unavailable");
  });

  it.each([
    ["две строки", { kind: "rows", rows: [HASH_ROW(2), HASH_ROW(2)] }],
    ["hash null в строке", { kind: "rows", rows: [{ password_hash: null, session_version: 2 }] }],
    ["версия 1 в строке", { kind: "rows", rows: [{ password_hash: GOLDEN_PBKDF2_HASH, session_version: 1 }] }],
    ["битый JSON", { kind: "text", text: "[{" }],
    ["нет таблицы 404 PGRST205", { kind: "status", status: 404, body: { code: "PGRST205" } }],
    ["нет таблицы 42P01", { kind: "status", status: 404, body: { code: "42P01" } }],
    ["403", { kind: "status", status: 403, body: { code: "42501" } }],
    ["401", { kind: "status", status: 401, body: { message: "bad key" } }],
    ["outage 503", { kind: "status", status: 503, body: { message: "down" } }],
  ] as [string, Credentials][])("%s: отказ без fallback на env — ни proof, ни boolean, ни версия", async (_label, credentials) => {
    const ports = createLegacyAdminPorts(BINDINGS, backend(credentials).fetcher);
    for (const attempt of [
      ports.verifyPasswordWithVersion(FIXTURE_ENV_PASSWORD),
      ports.verifyPassword(FIXTURE_ENV_PASSWORD),
      ports.credentialVersion(),
    ]) {
      const error = await rejection(attempt);
      expect(error).toBeInstanceOf(LegacyPasswordVerifierError);
    }
  });

  it.each([
    ["нет URL", { SUPABASE_URL: "", ADMIN_SUPABASE_KEY: PRIVATE_KEY, ADMIN_PASSWORD: FIXTURE_ENV_PASSWORD }],
    ["нет ключа", { SUPABASE_URL: URL_BASE, ADMIN_SUPABASE_KEY: "", ADMIN_PASSWORD: FIXTURE_ENV_PASSWORD }],
    ["не-ASCII ключ", { SUPABASE_URL: URL_BASE, ADMIN_SUPABASE_KEY: "sb_secret_ключ", ADMIN_PASSWORD: FIXTURE_ENV_PASSWORD }],
    ["ftp", { SUPABASE_URL: "ftp://127.0.0.1:1", ADMIN_SUPABASE_KEY: PRIVATE_KEY, ADMIN_PASSWORD: FIXTURE_ENV_PASSWORD }],
    ["userinfo", { SUPABASE_URL: "http://u:p@127.0.0.1:1", ADMIN_SUPABASE_KEY: PRIVATE_KEY, ADMIN_PASSWORD: FIXTURE_ENV_PASSWORD }],
    ["ключ с пробелом внутри управляющего символа", { SUPABASE_URL: URL_BASE, ADMIN_SUPABASE_KEY: "a\tb", ADMIN_PASSWORD: FIXTURE_ENV_PASSWORD }],
  ])("невалидные bindings (%s): безопасный отказ, ни одного fetch, без секретов в ошибках", async (_label, bindings) => {
    const b = backend({ kind: "rows", rows: [] });
    const errors: Error[] = [];
    let ports: ReturnType<typeof createLegacyAdminPorts> | null = null;
    try {
      ports = createLegacyAdminPorts(bindings, b.fetcher);
    } catch (error) {
      errors.push(error as Error);
    }
    if (ports) {
      for (const attempt of [
        ports.reserve("a".repeat(64)),
        ports.finish("reservation-1", true),
        ports.verifyPasswordWithVersion(FIXTURE_ENV_PASSWORD),
        ports.verifyPassword(FIXTURE_ENV_PASSWORD),
        ports.credentialVersion(),
      ]) errors.push(await rejection(attempt));
    }
    expect(errors.length).toBeGreaterThan(0);
    expect(b.calls).toHaveLength(0);
    for (const error of errors) {
      expect(`${error.message} ${String(error)}`).not.toMatch(/sb_secret|ключ|fixture-env-password/);
      expect(error.cause).toBeUndefined();
    }
  });

  it("не мутирует bindings и не запоминает их изменения после создания", async () => {
    const bindings = { ...BINDINGS };
    const frozen = Object.freeze({ ...BINDINGS });
    const b = backend({ kind: "rows", rows: [] });
    const ports = createLegacyAdminPorts(bindings, b.fetcher);
    bindings.ADMIN_PASSWORD = FIXTURE_WRONG_PASSWORD;
    bindings.ADMIN_SUPABASE_KEY = "sb_secret_fake07";
    await expect(ports.verifyPasswordWithVersion(FIXTURE_ENV_PASSWORD)).resolves.toEqual({ valid: true, credentialVersion: 1 });
    expect(b.calls[0].headers.get("apikey")).toBe(PRIVATE_KEY);
    expect(() => createLegacyAdminPorts(frozen, b.fetcher)).not.toThrow();
  });

  it("никогда не обращается к /auth/v1/*; читает ровно admin_credentials и два RPC", async () => {
    const b = backend({ kind: "rows", rows: [HASH_ROW(2)] });
    const ports = createLegacyAdminPorts(BINDINGS, b.fetcher);
    await ports.reserve("a".repeat(64));
    await ports.verifyPasswordWithVersion(GOLDEN_HASH_PASSWORD);
    await ports.verifyPassword(GOLDEN_HASH_PASSWORD);
    await ports.credentialVersion();
    await ports.finish("reservation-1", true);

    expect(b.calls.some((call) => new URL(call.url).pathname.startsWith("/auth"))).toBe(false);
    expect(paths(b)).toEqual([
      "POST /rest/v1/rpc/begin_admin_auth_attempt",
      "GET /rest/v1/admin_credentials",
      "GET /rest/v1/admin_credentials",
      "GET /rest/v1/admin_credentials",
      "POST /rest/v1/rpc/finish_admin_auth_attempt",
    ]);
    const reads = b.calls.filter((call) => call.method === "GET");
    for (const call of reads) {
      expect(call.url).toBe(CREDENTIAL_URL);
      expect(call.headers.get("apikey")).toBe(PRIVATE_KEY);
      expect(call.body).toBeNull();
    }
    for (const call of b.calls) expect(call.url).not.toContain(PRIVATE_KEY);
  });

  it("ключ и пароль не попадают в консоль", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}));
    const ports = createLegacyAdminPorts(BINDINGS, backend({ kind: "status", status: 503, body: { message: "down" } }).fetcher);
    await rejection(ports.verifyPasswordWithVersion(FIXTURE_ENV_PASSWORD));
    await rejection(ports.reserve("a".repeat(64)).then(() => { throw new Error("x"); }));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("handler + createLegacyAdminPorts", () => {
  function login(b: Backend, password: string, bindings = BINDINGS) {
    const ports = createLegacyAdminPorts(bindings, b.fetcher);
    return createAdminHandler({
      ...ports,
      assets: { fetch: async () => new Response("ok", { headers: { "content-type": "text/html" } }) },
      secret: SECRET,
      clientIp: "203.0.113.20",
      now: () => NOW,
    })(new Request(`${ORIGIN}/api/admin/login`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password }),
    }));
  }
  async function cookieVersion(response: Response | null) {
    const token = /admin_session=([^;]+)/.exec(response?.headers.get("set-cookie") ?? "")?.[1];
    return token ? (await createSessionCodec(SECRET, () => NOW).read(token))?.credentialVersion ?? null : null;
  }

  it("hash row версии 3: cookie версии 3; запросы reserve → read → finish → read, без /auth", async () => {
    const b = backend({ kind: "rows", rows: [HASH_ROW(3)] });
    const response = await login(b, GOLDEN_HASH_PASSWORD);

    expect(response?.headers.get("location")).toBe("/admin");
    expect(await cookieVersion(response)).toBe(3);
    expect(paths(b)).toEqual([
      "POST /rest/v1/rpc/begin_admin_auth_attempt",
      "GET /rest/v1/admin_credentials",
      "POST /rest/v1/rpc/finish_admin_auth_attempt",
      "GET /rest/v1/admin_credentials",
    ]);
    expect(JSON.parse(b.calls[2].body!)).toEqual({ p_reservation_id: "reservation-1", p_password_is_valid: true });
  });

  it("пустая строка: env-пароль входит с версией 1", async () => {
    const response = await login(backend({ kind: "rows", rows: [] }), FIXTURE_ENV_PASSWORD);
    expect(response?.headers.get("location")).toBe("/admin");
    expect(await cookieVersion(response)).toBe(1);
  });

  it("env-пароль не входит при существующем хеше; finish(false)", async () => {
    const b = backend({ kind: "rows", rows: [HASH_ROW(2)] });
    const response = await login(b, FIXTURE_ENV_PASSWORD);

    expect(response?.headers.get("location")).toBe("/admin/login?error=1");
    expect(response?.headers.get("set-cookie")).toBeNull();
    expect(JSON.parse(b.calls.at(-1)!.body!)).toEqual({ p_reservation_id: "reservation-1", p_password_is_valid: false });
  });

  it.each([
    ["outage", { kind: "status", status: 503, body: {} }],
    ["нет таблицы", { kind: "status", status: 404, body: { code: "PGRST205" } }],
    ["две строки", { kind: "rows", rows: [HASH_ROW(2), HASH_ROW(2)] }],
  ] as [string, Credentials][])("%s: вход закрыт без cookie и без fallback на env", async (_label, credentials) => {
    const b = backend(credentials);
    const response = await login(b, FIXTURE_ENV_PASSWORD);

    expect(response?.headers.get("location")).toBe("/admin/login?error=security");
    expect(response?.headers.get("set-cookie")).toBeNull();
    expect(JSON.parse(b.calls.at(-1)!.body!)).toEqual({ p_reservation_id: "reservation-1", p_password_is_valid: false });
  });
});
