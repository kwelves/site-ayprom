import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminCredentialWriterError,
  createAdminCredentialWriter,
  type AdminCredentialWriterErrorCode,
} from "@/cloudflare/admin/credential-writer";
import { GOLDEN_PBKDF2_HASH } from "./support/legacy-password-verifier-fixtures";

const SUPABASE_URL = "http://127.0.0.1:54998";
const SECRET_KEY = "sb_secret_fake04";
const JWT_KEY = "eyJfixture.writer.jwt-not-real";
const NOW = Date.parse("2026-10-01T09:30:00.000Z");
const INSERT_URL = `${SUPABASE_URL}/rest/v1/admin_credentials?select=session_version`;
const patchUrl = (version: number) =>
  `${SUPABASE_URL}/rest/v1/admin_credentials?credential_key=eq.primary&session_version=eq.${version}&select=session_version`;

type Responder = (url: URL, init: RequestInit) => Response | Promise<Response>;

function setup(
  responses: Responder | Responder[],
  bindings: Record<string, unknown> = { SUPABASE_URL, ADMIN_SUPABASE_KEY: SECRET_KEY },
) {
  const queue = Array.isArray(responses) ? [...responses] : null;
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const responder = queue ? queue.shift() : responses as Responder;
    if (!responder) throw new Error("unexpected extra request");
    return responder(new URL(String(input)), init);
  });
  const writer = createAdminCredentialWriter(bindings as never, fetcher as unknown as typeof fetch, () => NOW);
  return { writer, fetcher, calls };
}

const created = (version: number) => () => Response.json([{ session_version: version }], { status: 201 });
const updated = (rows: unknown) => () => Response.json(rows, { status: 200 });

async function codeOf(promise: Promise<unknown>): Promise<AdminCredentialWriterErrorCode> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AdminCredentialWriterError);
    expect((error as Error).cause).toBeUndefined();
    return (error as AdminCredentialWriterError).code;
  }
  throw new Error("expected rejection");
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each([
  ["clock throws", () => { throw new Error(SECRET_KEY); }],
  ["clock returns NaN", () => Number.NaN],
  ["clock returns out-of-range timestamp", () => 9e15],
])("invalid clock (%s) fails with a fixed error before fetch", async (_name, clock) => {
  const fetcher = vi.fn();
  const writer = createAdminCredentialWriter(
    { SUPABASE_URL, ADMIN_SUPABASE_KEY: SECRET_KEY },
    fetcher as unknown as typeof fetch,
    clock,
  );
  expect(await codeOf(writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 1))).toBe("backend_unavailable");
  expect(fetcher).not.toHaveBeenCalled();
});

describe("версия 1: INSERT", () => {
  it("один POST, primary с версией 2, ответ подтверждает версию 2", async () => {
    const { writer, calls } = setup(created(2));
    await expect(writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 1)).resolves.toBe(2);

    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url).toBe(INSERT_URL);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(JSON.parse(String(init.body))).toEqual({
      credential_key: "primary",
      password_hash: GOLDEN_PBKDF2_HASH,
      session_version: 2,
      updated_at: "2026-10-01T09:30:00.000Z",
    });
    const headers = new Headers(init.headers);
    expect(headers.get("apikey")).toBe(SECRET_KEY);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("prefer")).toBe("return=representation");
    expect(headers.get("content-type")).toBe("application/json");
    expect(url).not.toContain(SECRET_KEY);
    expect(url).not.toContain(GOLDEN_PBKDF2_HASH);
  });

  it("legacy JWT-ключ дополнительно передаётся как Bearer, но не в URL", async () => {
    const { writer, calls } = setup(created(2), { SUPABASE_URL, ADMIN_SUPABASE_KEY: JWT_KEY });
    await writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 1);
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe(`Bearer ${JWT_KEY}`);
    expect(calls[0].url).not.toContain(JWT_KEY);
  });

  it("duplicate key (409, 23505) — конфликт, а не ошибка backend", async () => {
    const { writer } = setup(() => Response.json({ code: "23505", message: "duplicate key value" }, { status: 409 }));
    expect(await codeOf(writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 1))).toBe("conflict");
  });

  it.each([
    ["другой 409 (23503)", 409, { code: "23503" }],
    ["409 без кода", 409, {}],
    ["409 не объект", 409, "conflict"],
  ])("%s — не конфликт", async (_label, status, body) => {
    const { writer } = setup(() => Response.json(body, { status }));
    expect(await codeOf(writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 1))).toBe("backend_unavailable");
  });

  it.each([
    ["200 вместо 201", () => Response.json([{ session_version: 2 }], { status: 200 })],
    ["версия не 2", created(3)],
    ["пустой массив", () => Response.json([], { status: 201 })],
    ["две строки", () => Response.json([{ session_version: 2 }, { session_version: 2 }], { status: 201 })],
    ["не массив", () => Response.json({ session_version: 2 }, { status: 201 })],
    ["нет поля", () => Response.json([{}], { status: 201 })],
    ["версия строкой", () => Response.json([{ session_version: "2" }], { status: 201 })],
    ["null", () => Response.json(null, { status: 201 })],
    ["204 без тела", () => new Response(null, { status: 204 })],
  ] as [string, Responder][])("неверный ответ (%s) — не успех", async (_label, responder) => {
    const { writer } = setup(responder);
    expect(await codeOf(writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 1))).toMatch(/^(response_invalid|backend_unavailable)$/);
  });
});

describe("версия >= 2: PATCH только при совпадении session_version", () => {
  it.each([2, 5, 1_000_000])("версия %i → PATCH primary с eq.%i, успех подтверждается версией +1", async (expected) => {
    const { writer, calls } = setup(updated([{ session_version: expected + 1 }]));
    await expect(writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, expected)).resolves.toBe(expected + 1);

    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url).toBe(patchUrl(expected));
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      password_hash: GOLDEN_PBKDF2_HASH,
      session_version: expected + 1,
      updated_at: "2026-10-01T09:30:00.000Z",
    });
    const headers = new Headers(init.headers);
    expect(headers.get("apikey")).toBe(SECRET_KEY);
    expect(headers.get("prefer")).toBe("return=representation");
    expect(url).not.toContain(SECRET_KEY);
    expect(url).not.toContain(GOLDEN_PBKDF2_HASH);
  });

  it("устаревшая версия: пустой результат — конфликт", async () => {
    const { writer } = setup(updated([]));
    expect(await codeOf(writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 2))).toBe("conflict");
  });

  it.each([
    ["версия не +1", updated([{ session_version: 9 }])],
    ["две строки", updated([{ session_version: 3 }, { session_version: 3 }])],
    ["не массив", updated({ session_version: 3 })],
    ["нет поля", updated([{}])],
    ["null", updated(null)],
    ["версия дробная", updated([{ session_version: 3.5 }])],
    ["201 вместо 200", () => Response.json([{ session_version: 3 }], { status: 201 })],
  ] as [string, Responder][])("неверный ответ (%s) — не успех и не конфликт", async (_label, responder) => {
    const { writer } = setup(responder);
    expect(await codeOf(writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 2))).toBe("response_invalid");
  });

  it("последовательные замены: каждая — один свежий запрос со своей версией", async () => {
    const { writer, calls } = setup([updated([{ session_version: 3 }]), updated([{ session_version: 4 }]), updated([])]);
    await expect(writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 2)).resolves.toBe(3);
    await expect(writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 3)).resolves.toBe(4);
    expect(await codeOf(writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 3))).toBe("conflict");
    expect(calls.map((c) => c.url)).toEqual([patchUrl(2), patchUrl(3), patchUrl(3)]);
  });
});

describe("backend и транспорт", () => {
  it.each([
    ["500", 500], ["503", 503], ["401", 401], ["403", 403], ["404 (нет таблицы)", 404], ["400", 400],
  ])("%s — backend_unavailable, никогда не конфликт и не успех", async (_label, status) => {
    for (const expected of [1, 2]) {
      const { writer } = setup(() => Response.json({ code: "PGRST205", message: "missing" }, { status }));
      expect(await codeOf(writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, expected))).toBe("backend_unavailable");
    }
  });

  it.each([301, 302, 307, 308])("redirect %i отклоняется без перехода", async (status) => {
    for (const expected of [1, 2]) {
      const { writer, calls } = setup(() => new Response(null, { status, headers: { location: "http://127.0.0.1:1/sink" } }));
      expect(await codeOf(writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, expected))).toBe("backend_unavailable");
      expect(calls).toHaveLength(1);
    }
  });

  it("ответ больше 64 КиБ отклоняется", async () => {
    const { writer } = setup(() => new Response(`[${" ".repeat(65_536)}]`, { status: 200 }));
    expect(await codeOf(writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 2))).toBe("backend_unavailable");
  });

  it("зависшее тело прерывается общим сроком 10 с, без повтора", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("[")); },
      cancel() { cancelled = true; },
    });
    const { writer, fetcher } = setup(() => new Response(body, { status: 200 }));
    const pending = codeOf(writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 2));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(cancelled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toBe("backend_unavailable");
    expect(cancelled).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("сетевая ошибка и битый JSON — один вызов, backend_unavailable", async () => {
    const network = setup(() => { throw new Error(`connect ECONNREFUSED ${SECRET_KEY}`); });
    expect(await codeOf(network.writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 2))).toBe("backend_unavailable");
    expect(network.fetcher).toHaveBeenCalledTimes(1);
    const broken = setup(() => new Response("[{", { status: 200 }));
    expect(await codeOf(broken.writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 2))).toBe("backend_unavailable");
  });

  it("только записи primary: никаких GET, DELETE, RPC и других путей", async () => {
    const { writer, calls } = setup([created(2), updated([{ session_version: 3 }])]);
    await writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 1);
    await writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 2);
    expect(calls.map((c) => [c.init.method, new URL(c.url).pathname])).toEqual([
      ["POST", "/rest/v1/admin_credentials"],
      ["PATCH", "/rest/v1/admin_credentials"],
    ]);
  });
});

describe("вход отклоняется до fetch", () => {
  it.each([
    ["0", 0], ["-1", -1], ["дробная", 1.5], ["NaN", Number.NaN], ["Infinity", Number.POSITIVE_INFINITY],
    ["строка", "2"], ["null", null], ["undefined", undefined],
    ["MAX_SAFE_INTEGER (следующая версия переполняет)", Number.MAX_SAFE_INTEGER],
    ["2**53", 2 ** 53], ["больше 2**53", 2 ** 60],
  ])("версия %s", async (_label, version) => {
    const { writer, fetcher } = setup(created(2));
    expect(await codeOf(writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, version as number))).toBe("input_invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("MAX_SAFE_INTEGER - 1 допустима: следующая версия ещё safe integer", async () => {
    const expected = Number.MAX_SAFE_INTEGER - 1;
    const { writer } = setup(updated([{ session_version: Number.MAX_SAFE_INTEGER }]));
    await expect(writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, expected)).resolves.toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    ["пустой", ""], ["не строка", 42], ["null", null], ["undefined", undefined], ["объект", {}],
    ["слишком большой (1025)", "x".repeat(1025)], ["огромный", "x".repeat(200_000)],
  ])("hash: %s", async (_label, hash) => {
    const { writer, fetcher } = setup(created(2));
    expect(await codeOf(writer.replacePasswordHash(hash as string, 1))).toBe("input_invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("hash длиной ровно 1024 допустим (проверка формата — дело verifier)", async () => {
    const { writer, calls } = setup(created(2));
    await writer.replacePasswordHash("x".repeat(1024), 1);
    expect(JSON.parse(String(calls[0].init.body)).password_hash).toHaveLength(1024);
  });

  it.each([
    ["нет URL", { SUPABASE_URL: "", ADMIN_SUPABASE_KEY: SECRET_KEY }],
    ["непарсируемый URL", { SUPABASE_URL: "not a url", ADMIN_SUPABASE_KEY: SECRET_KEY }],
    ["схема ftp", { SUPABASE_URL: "ftp://127.0.0.1:1", ADMIN_SUPABASE_KEY: SECRET_KEY }],
    ["userinfo", { SUPABASE_URL: "http://u:p@127.0.0.1:1", ADMIN_SUPABASE_KEY: SECRET_KEY }],
    ["нет ключа", { SUPABASE_URL }],
    ["пустой ключ", { SUPABASE_URL, ADMIN_SUPABASE_KEY: "" }],
    ["ключ из пробелов", { SUPABASE_URL, ADMIN_SUPABASE_KEY: "   " }],
    ["не-ASCII ключ", { SUPABASE_URL, ADMIN_SUPABASE_KEY: "sb_secret_ключ" }],
    ["ключ с переводом строки", { SUPABASE_URL, ADMIN_SUPABASE_KEY: "sb_secret_a\nX: 1" }],
    ["bindings null", null],
  ])("bindings: %s", async (_label, bindings) => {
    const { writer, fetcher } = setup(created(2), bindings as never);
    expect(await codeOf(writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 1))).toBe("configuration_invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("путь, query и fragment базового URL заменяются", async () => {
    const { writer, calls } = setup(created(2), { SUPABASE_URL: `${SUPABASE_URL}/x/y?a=1#f`, ADMIN_SUPABASE_KEY: SECRET_KEY });
    await writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 1);
    expect(calls[0].url).toBe(INSERT_URL);
  });
});

describe("ошибки и утечки", () => {
  it("сообщения фиксированы: ни ключа, ни hash, ни ответа backend; консоль не используется", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}));
    const attempts = [
      setup(() => Response.json({ code: "42501", message: `denied ${SECRET_KEY} ${GOLDEN_PBKDF2_HASH}` }, { status: 403 })).writer
        .replacePasswordHash(GOLDEN_PBKDF2_HASH, 2),
      setup(() => Response.json({ code: "23505", detail: GOLDEN_PBKDF2_HASH }, { status: 409 })).writer
        .replacePasswordHash(GOLDEN_PBKDF2_HASH, 1),
      setup(updated([])).writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 2),
      setup(updated([{ session_version: 99 }])).writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 2),
      setup(() => { throw new Error(`${SECRET_KEY} ${GOLDEN_PBKDF2_HASH}`); }).writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 2),
      setup(created(2)).writer.replacePasswordHash("", 1),
      setup(created(2), { SUPABASE_URL: `http://u:${SECRET_KEY}@x.invalid`, ADMIN_SUPABASE_KEY: SECRET_KEY }).writer
        .replacePasswordHash(GOLDEN_PBKDF2_HASH, 1),
    ];
    for (const attempt of attempts) {
      const error = await attempt.then(() => { throw new Error("expected rejection"); }, (reason: Error) => reason);
      expect(error).toBeInstanceOf(AdminCredentialWriterError);
      expect(error.cause).toBeUndefined();
      const text = `${error.message} ${String(error)} ${JSON.stringify(error)}`;
      expect(text).not.toMatch(/sb_secret|pbkdf2|AAECAwQF|denied|42501|23505|x\.invalid/);
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("не мутирует bindings", async () => {
    const bindings = Object.freeze({ SUPABASE_URL, ADMIN_SUPABASE_KEY: ` ${SECRET_KEY} ` });
    const { writer, calls } = setup(created(2), bindings);
    await writer.replacePasswordHash(GOLDEN_PBKDF2_HASH, 1);
    expect(new Headers(calls[0].init.headers).get("apikey")).toBe(SECRET_KEY);
    expect(bindings.ADMIN_SUPABASE_KEY).toBe(` ${SECRET_KEY} `);
  });
});
