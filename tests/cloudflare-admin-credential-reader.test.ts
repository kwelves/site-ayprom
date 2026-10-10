import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminCredentialReaderError,
  createAdminCredentialReader,
} from "@/cloudflare/admin/credential-reader";
import {
  LegacyPasswordVerifierError,
  createLegacyPasswordVerifier,
} from "@/cloudflare/admin/legacy-password-verifier";
import {
  FIXTURE_ENV_PASSWORD,
  FIXTURE_WRONG_PASSWORD,
  GOLDEN_HASH_PASSWORD,
  GOLDEN_PBKDF2_HASH,
} from "./support/legacy-password-verifier-fixtures";

const SUPABASE_URL = "http://127.0.0.1:54999";
const SECRET_KEY = "sb_secret_fake02";
const JWT_KEY = "eyJfixture.reader.jwt-not-real";
const EXPECTED_URL =
  "http://127.0.0.1:54999/rest/v1/admin_credentials?select=password_hash%2Csession_version&credential_key=eq.primary&limit=2";

type Responder = (url: URL, init: RequestInit) => Response | Promise<Response>;

function setup(responses: Responder | Responder[], bindings: Record<string, string> = {
  SUPABASE_URL, ADMIN_SUPABASE_KEY: SECRET_KEY,
}) {
  const queue = Array.isArray(responses) ? [...responses] : null;
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const responder = queue ? queue.shift() : responses as Responder;
    if (!responder) throw new Error("unexpected extra request");
    return responder(new URL(String(input)), init);
  });
  const read = createAdminCredentialReader(bindings as never, fetcher as unknown as typeof fetch);
  return { read, fetcher, calls };
}

const json = (body: unknown, status = 200) => () => Response.json(body, { status });
const HASH_ROW = { password_hash: GOLDEN_PBKDF2_HASH, session_version: 2 };

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AdminCredentialReaderError);
    expect((error as Error).cause).toBeUndefined();
    return (error as AdminCredentialReaderError).code;
  }
  throw new Error("expected rejection");
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("запрос", () => {
  it("ровно один GET с фиксированным URL; ключ только в apikey, без Bearer для не-JWT ключа", async () => {
    const { read, calls } = setup(json([]));
    await read();

    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url).toBe(EXPECTED_URL);
    expect(url).not.toContain(SECRET_KEY);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe("manual");
    const headers = new Headers(init.headers);
    expect(headers.get("apikey")).toBe(SECRET_KEY);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("accept")).toBe("application/json");
  });

  it("legacy JWT-ключ дополнительно передаётся как Bearer (как в supabase-ports)", async () => {
    const { read, calls } = setup(json([]), { SUPABASE_URL, ADMIN_SUPABASE_KEY: JWT_KEY });
    await read();
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("apikey")).toBe(JWT_KEY);
    expect(headers.get("authorization")).toBe(`Bearer ${JWT_KEY}`);
    expect(calls[0].url).not.toContain(JWT_KEY);
  });

  it("путь и query базового URL заменяются, а не дополняются", async () => {
    const { read, calls } = setup(json([]), { SUPABASE_URL: `${SUPABASE_URL}/ignored/path?x=1#frag`, ADMIN_SUPABASE_KEY: SECRET_KEY });
    await read();
    expect(calls[0].url).toBe(EXPECTED_URL);
  });

  it.each([
    ["пустой URL", { SUPABASE_URL: "", ADMIN_SUPABASE_KEY: SECRET_KEY }],
    ["непарсируемый URL", { SUPABASE_URL: "not a url", ADMIN_SUPABASE_KEY: SECRET_KEY }],
    ["схема ftp", { SUPABASE_URL: "ftp://127.0.0.1:54999", ADMIN_SUPABASE_KEY: SECRET_KEY }],
    ["схема javascript", { SUPABASE_URL: "javascript:alert(1)", ADMIN_SUPABASE_KEY: SECRET_KEY }],
    ["userinfo", { SUPABASE_URL: "http://user:pass@127.0.0.1:54999", ADMIN_SUPABASE_KEY: SECRET_KEY }],
    ["только username", { SUPABASE_URL: "http://user@127.0.0.1:54999", ADMIN_SUPABASE_KEY: SECRET_KEY }],
    ["пустой ключ", { SUPABASE_URL, ADMIN_SUPABASE_KEY: "" }],
    ["ключ из пробелов", { SUPABASE_URL, ADMIN_SUPABASE_KEY: "   " }],
    ["ключ с переводом строки", { SUPABASE_URL, ADMIN_SUPABASE_KEY: "sb_secret_a\nX-Injected: 1" }],
    ["ключ с символом за пределами ByteString", { SUPABASE_URL, ADMIN_SUPABASE_KEY: "sb_secret_\u0100" }],
    ["ключ с emoji", { SUPABASE_URL, ADMIN_SUPABASE_KEY: "sb_secret_🔐" }],
    ["ключ с C1 control", { SUPABASE_URL, ADMIN_SUPABASE_KEY: "sb_secret_\u0080" }],
    ["нет ключа", { SUPABASE_URL }],
  ])("невалидные bindings (%s) — отказ до fetch", async (_label, bindings) => {
    const { read, fetcher } = setup(json([]), bindings as Record<string, string>);
    expect(await codeOf(read())).toBe("configuration_invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("не мутирует bindings", async () => {
    const bindings = Object.freeze({ SUPABASE_URL: `${SUPABASE_URL}/x`, ADMIN_SUPABASE_KEY: ` ${SECRET_KEY} ` });
    const { read } = setup(json([]), bindings);
    await read();
    expect(bindings).toEqual({ SUPABASE_URL: `${SUPABASE_URL}/x`, ADMIN_SUPABASE_KEY: ` ${SECRET_KEY} ` });
  });
});

describe("успешные ответы", () => {
  it("[] означает пустую таблицу: { passwordHash: null, sessionVersion: 1 }", async () => {
    const { read } = setup(json([]));
    await expect(read()).resolves.toEqual({ passwordHash: null, sessionVersion: 1 });
  });

  it("одна строка → её хеш и версия; возвращается новый объект, ответ не мутируется", async () => {
    const row = Object.freeze({ ...HASH_ROW });
    const payload = Object.freeze([row]);
    const { read } = setup(() => Response.json(payload));
    const state = await read();
    expect(state).toEqual({ passwordHash: GOLDEN_PBKDF2_HASH, sessionVersion: 2 });
    expect(state).not.toBe(row);
  });

  it("повреждённый, но непустой хеш передаётся verifier как есть (разбор PBKDF2 не дублируется)", async () => {
    const { read } = setup(json([{ password_hash: "not-a-pbkdf2-hash", session_version: 5 }]));
    await expect(read()).resolves.toEqual({ passwordHash: "not-a-pbkdf2-hash", sessionVersion: 5 });
  });

  it("состояние читается заново при каждом вызове, без кэша", async () => {
    const { read, fetcher } = setup([
      json([]),
      json([HASH_ROW]),
      json([{ ...HASH_ROW, session_version: 3 }]),
    ]);
    await expect(read()).resolves.toEqual({ passwordHash: null, sessionVersion: 1 });
    await expect(read()).resolves.toEqual({ passwordHash: GOLDEN_PBKDF2_HASH, sessionVersion: 2 });
    await expect(read()).resolves.toEqual({ passwordHash: GOLDEN_PBKDF2_HASH, sessionVersion: 3 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe("некорректный ответ — отказ, а не пустая таблица", () => {
  it.each([
    ["две строки", [HASH_ROW, HASH_ROW]],
    ["объект вместо массива", {}],
    ["null", null],
    ["строка", "[]"],
    ["строка не объект", [null]],
    ["строка — массив", [[]]],
    ["строка — скаляр", ["x"]],
    ["hash null", [{ password_hash: null, session_version: 2 }]],
    ["hash отсутствует", [{ session_version: 2 }]],
    ["hash пустой", [{ password_hash: "", session_version: 2 }]],
    ["hash не строка", [{ password_hash: 42, session_version: 2 }]],
    ["version 1 (SQL требует >= 2)", [{ ...HASH_ROW, session_version: 1 }]],
    ["version 0", [{ ...HASH_ROW, session_version: 0 }]],
    ["version отрицательная", [{ ...HASH_ROW, session_version: -3 }]],
    ["version дробная", [{ ...HASH_ROW, session_version: 2.5 }]],
    ["version строка", [{ ...HASH_ROW, session_version: "2" }]],
    ["version вне safe integer", [{ ...HASH_ROW, session_version: 2 ** 53 }]],
    ["version отсутствует", [{ password_hash: GOLDEN_PBKDF2_HASH }]],
    ["PostgREST-ошибка со статусом 200", { code: "PGRST205", message: "missing" }],
  ])("%s", async (_label, payload) => {
    const { read } = setup(json(payload));
    expect(await codeOf(read())).toBe("response_invalid");
  });

  it("битый JSON", async () => {
    const { read } = setup(() => new Response("[{", { status: 200 }));
    expect(await codeOf(read())).toBe("backend_unavailable");
  });

  it.each([201, 206])("2xx, но не 200 (%i) — отказ даже с телом []", async (status) => {
    const { read } = setup(() => new Response("[]", { status }));
    expect(await codeOf(read())).toBe("response_invalid");
  });

  it("204 без тела — отказ", async () => {
    const { read } = setup(() => new Response(null, { status: 204 }));
    expect(await codeOf(read())).toBe("backend_unavailable");
  });

  it.each([
    ["404 PGRST205 (нет таблицы)", 404, { code: "PGRST205", message: "Could not find the table" }],
    ["404 42P01", 404, { code: "42P01", message: "relation does not exist" }],
    ["404 без тела-ошибки", 404, []],
    ["401", 401, { message: "Invalid API key" }],
    ["403 permission", 403, { code: "42501", message: "permission denied" }],
    ["500", 500, { message: "internal" }],
    ["503", 503, { message: "unavailable" }],
  ])("%s — отказ, не пустая таблица", async (_label, status, body) => {
    const { read } = setup(json(body, status));
    expect(await codeOf(read())).toBe("backend_unavailable");
  });
});

describe("транспорт через requestAdminJson", () => {
  it.each([301, 302, 307, 308])("redirect %i отклоняется без перехода", async (status) => {
    const { read, calls } = setup(() => new Response(null, { status, headers: { location: "http://127.0.0.1:1/sink" } }));
    expect(await codeOf(read())).toBe("backend_unavailable");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(EXPECTED_URL);
  });

  it("тело больше 64 КиБ отклоняется", async () => {
    const oversized = `[${" ".repeat(65_536)}]`;
    const { read } = setup(() => new Response(oversized, { status: 200 }));
    expect(await codeOf(read())).toBe("backend_unavailable");
  });

  it("зависшее тело прерывается общим 10-секундным сроком, без повтора", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("[")); },
      cancel() { cancelled = true; },
    });
    const { read, fetcher } = setup(() => new Response(body, { status: 200 }));
    const pending = codeOf(read());
    await vi.advanceTimersByTimeAsync(9_999);
    expect(cancelled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toBe("backend_unavailable");
    expect(cancelled).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("сетевая ошибка — один вызов, без повтора и утечки деталей", async () => {
    const { read, fetcher } = setup(() => { throw new Error(`connect ECONNREFUSED ${SECRET_KEY}`); });
    expect(await codeOf(read())).toBe("backend_unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("ошибки и логи", () => {
  it("сообщения фиксированы, без ключа, хеша, payload и cause; консоль не используется", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}));
    const cases = [
      setup(json({ code: "42501", message: `denied ${SECRET_KEY}` }, 403)).read(),
      setup(json([{ password_hash: GOLDEN_PBKDF2_HASH, session_version: 1 }])).read(),
      setup(() => { throw new Error(SECRET_KEY); }).read(),
      setup(json([]), { SUPABASE_URL: `http://u:${SECRET_KEY}@x.invalid`, ADMIN_SUPABASE_KEY: SECRET_KEY }).read(),
    ];
    for (const attempt of cases) {
      const error = await attempt.then(() => { throw new Error("expected rejection"); }, (reason: Error) => reason);
      expect(error).toBeInstanceOf(AdminCredentialReaderError);
      expect(error.cause).toBeUndefined();
      const text = `${error.message} ${String(error)} ${JSON.stringify(error)}`;
      expect(text).not.toMatch(/sb_secret|pbkdf2|denied|42501|AAECAwQF/);
      expect(error.message).toBe("Admin credential state unavailable");
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("reader + legacy verifier", () => {
  function verifierWith(responder: Responder | Responder[]) {
    const { read, fetcher } = setup(responder);
    const readEnvPassword = vi.fn(() => FIXTURE_ENV_PASSWORD);
    return { verifier: createLegacyPasswordVerifier({ readCredentialState: read, readEnvPassword }), readEnvPassword, fetcher };
  }

  async function verifierCode(promise: Promise<unknown>) {
    const error = await promise.then(() => { throw new Error("expected rejection"); }, (reason: unknown) => reason);
    expect(error).toBeInstanceOf(LegacyPasswordVerifierError);
    return (error as LegacyPasswordVerifierError).code;
  }

  it.each([
    ["503 outage", json({ message: "down" }, 503)],
    ["404 PGRST205", json({ code: "PGRST205" }, 404)],
    ["403", json({ code: "42501" }, 403)],
    ["две строки", json([HASH_ROW, HASH_ROW])],
  ])("%s не открывает fallback на env", async (_label, responder) => {
    const { verifier, readEnvPassword } = verifierWith(responder);
    expect(await verifierCode(verifier.verifyPassword(FIXTURE_ENV_PASSWORD))).toBe("credential_state_unavailable");
    expect(await verifierCode(verifier.credentialVersion())).toBe("credential_state_unavailable");
    expect(readEnvPassword).not.toHaveBeenCalled();
  });

  it("[] открывает только фиктивный env-пароль, версия 1", async () => {
    const { verifier } = verifierWith(json([]));
    await expect(verifier.verifyPassword(FIXTURE_ENV_PASSWORD)).resolves.toBe(true);
    await expect(verifier.verifyPassword(FIXTURE_WRONG_PASSWORD)).resolves.toBe(false);
    await expect(verifier.credentialVersion()).resolves.toBe(1);
  });

  it("строка с хешем проверяет только хеш и не читает env", async () => {
    const { verifier, readEnvPassword } = verifierWith(json([HASH_ROW]));
    await expect(verifier.verifyPassword(GOLDEN_HASH_PASSWORD)).resolves.toBe(true);
    await expect(verifier.verifyPassword(FIXTURE_ENV_PASSWORD)).resolves.toBe(false);
    await expect(verifier.credentialVersion()).resolves.toBe(2);
    expect(readEnvPassword).not.toHaveBeenCalled();
  });
});
