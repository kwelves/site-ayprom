import { describe, expect, it, vi } from "vitest";
import type { AdminAuthPorts, AdminPasswordProof } from "@/cloudflare/admin/contracts";
import { createAdminHandler } from "@/cloudflare/admin/handler";
import {
  LegacyPasswordVerifierError,
  createLegacyPasswordVerifier,
  type LegacyCredentialState,
} from "@/cloudflare/admin/legacy-password-verifier";
import { createSessionCodec } from "@/lib/admin/session-codec";
import {
  FIXTURE_ENV_PASSWORD,
  FIXTURE_WRONG_PASSWORD,
  GOLDEN_HASH_PASSWORD,
  GOLDEN_PBKDF2_HASH,
  MALFORMED_HASH,
} from "./support/legacy-password-verifier-fixtures";

const ORIGIN = "https://www.ayprom-gidravlika.kg";
const SECRET = "worker-admin-cookie-local-test-secret-32-bytes";
const NOW = Date.parse("2026-09-30T12:00:00.000Z");

function loginRequest(password = "valid") {
  return new Request(`${ORIGIN}/api/admin/login`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password }),
  });
}

interface Harness {
  ports: AdminAuthPorts;
  events: string[];
  /** Mutable "database" version seen by credentialVersion(). */
  current: { version: number };
}

function harness(
  proof: (password: string) => Promise<AdminPasswordProof> | AdminPasswordProof,
  overrides: Partial<AdminAuthPorts> = {},
  startVersion = 2,
): Harness {
  const events: string[] = [];
  const current = { version: startVersion };
  const ports: AdminAuthPorts = {
    reserve: vi.fn(async () => {
      events.push("reserve");
      return { allowed: true, retryAfter: 0, reservationId: "reservation-1" };
    }),
    verifyPassword: vi.fn(async () => {
      events.push("legacy-verify");
      return true;
    }),
    verifyPasswordWithVersion: vi.fn(async (password: string) => {
      events.push("proof");
      return proof(password);
    }),
    finish: vi.fn(async () => {
      events.push("finish");
      return 0;
    }),
    credentialVersion: vi.fn(async () => {
      events.push("version");
      return current.version;
    }),
    assets: {
      fetch: vi.fn(async () => new Response("<h1>shell</h1>", { headers: { "content-type": "text/html" } })),
    },
    secret: SECRET,
    clientIp: "203.0.113.20",
    now: () => NOW,
    ...overrides,
  };
  return { ports, events, current };
}

async function cookieVersion(response: Response | null): Promise<number | null> {
  const cookie = response?.headers.get("set-cookie") ?? "";
  const token = /admin_session=([^;]+)/.exec(cookie)?.[1];
  if (!token) return null;
  return (await createSessionCodec(SECRET, () => NOW).read(token))?.credentialVersion ?? null;
}

function expectNoCookie(response: Response | null) {
  expect(response?.status).toBe(303);
  expect(response?.headers.get("set-cookie")).toBeNull();
}

describe("login: сессия только с проверенной версией", () => {
  it("стабильная версия: cookie несёт проверенную версию; старый boolean-порт не вызывается", async () => {
    const { ports, events } = harness(() => ({ valid: true, credentialVersion: 2 }));
    const response = await createAdminHandler(ports)(loginRequest());

    expect(response?.headers.get("location")).toBe("/admin");
    expect(await cookieVersion(response)).toBe(2);
    expect(events).toEqual(["reserve", "proof", "finish", "version"]);
    expect(ports.verifyPassword).not.toHaveBeenCalled();
    expect(ports.finish).toHaveBeenCalledTimes(1);
    expect(ports.finish).toHaveBeenCalledWith("reservation-1", true);
  });

  it("cookie получает проверенную версию, а не «актуальную» из отдельного чтения", async () => {
    // Порт вернул доказательство версии 5; отдельное чтение тоже 5 → 5.
    const { ports } = harness(() => ({ valid: true, credentialVersion: 5 }), {}, 5);
    expect(await cookieVersion(await createAdminHandler(ports)(loginRequest()))).toBe(5);
  });

  it.each([
    ["1→2 во время проверки пароля", 1, 2],
    ["2→3 во время проверки пароля", 2, 3],
  ])("смена версии %s: cookie не выдаётся", async (_label, proven, changed) => {
    const state = harness(() => ({ valid: true, credentialVersion: proven }), {}, proven);
    state.ports.verifyPasswordWithVersion = vi.fn(async () => {
      state.events.push("proof");
      const proof: AdminPasswordProof = { valid: true, credentialVersion: proven };
      state.current.version = changed; // пароль сменили сразу после чтения состояния
      return proof;
    });
    const response = await createAdminHandler(state.ports)(loginRequest());

    expectNoCookie(response);
    expect(response?.headers.get("location")).toBe("/admin/login?error=security");
    expect(state.ports.finish).toHaveBeenCalledTimes(1);
    expect(state.ports.finish).toHaveBeenCalledWith("reservation-1", true);
    expect(state.ports.verifyPassword).not.toHaveBeenCalled();
  });

  it.each([
    ["1→2 во время finish", 1, 2],
    ["2→3 во время finish", 2, 3],
  ])("смена версии %s: cookie не выдаётся", async (_label, proven, changed) => {
    const state = harness(() => ({ valid: true, credentialVersion: proven }), {}, proven);
    state.ports.finish = vi.fn(async () => {
      state.events.push("finish");
      state.current.version = changed;
      return 0;
    });
    const response = await createAdminHandler(state.ports)(loginRequest());

    expectNoCookie(response);
    expect(response?.headers.get("location")).toBe("/admin/login?error=security");
    expect(state.ports.finish).toHaveBeenCalledTimes(1);
    expect(state.events).toEqual(["reserve", "proof", "finish", "version"]);
  });

  it("неверный пароль: finish(false) один раз, версия не запрашивается, cookie нет", async () => {
    const { ports, events } = harness(() => ({ valid: false }));
    const response = await createAdminHandler(ports)(loginRequest());

    expectNoCookie(response);
    expect(response?.headers.get("location")).toBe("/admin/login?error=1");
    expect(events).toEqual(["reserve", "proof", "finish"]);
    expect(ports.finish).toHaveBeenCalledTimes(1);
    expect(ports.finish).toHaveBeenCalledWith("reservation-1", false);
    expect(ports.verifyPassword).not.toHaveBeenCalled();
  });

  it("неверный пароль не «спасается» старым boolean-портом, вернувшим true", async () => {
    const { ports } = harness(() => ({ valid: false }));
    vi.mocked(ports.verifyPassword).mockResolvedValue(true);
    const response = await createAdminHandler(ports)(loginRequest());

    expectNoCookie(response);
    expect(response?.headers.get("location")).toBe("/admin/login?error=1");
    expect(ports.verifyPassword).not.toHaveBeenCalled();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["строка", "ok"],
    ["true вместо объекта", true],
    ["пустой объект", {}],
    ["valid не boolean", { valid: "true", credentialVersion: 2 }],
    ["valid: true без версии", { valid: true }],
    ["версия 0", { valid: true, credentialVersion: 0 }],
    ["отрицательная версия", { valid: true, credentialVersion: -1 }],
    ["дробная версия", { valid: true, credentialVersion: 1.5 }],
    ["версия строкой", { valid: true, credentialVersion: "2" }],
    ["NaN", { valid: true, credentialVersion: Number.NaN }],
    ["Infinity", { valid: true, credentialVersion: Number.POSITIVE_INFINITY }],
    ["вне safe integer", { valid: true, credentialVersion: 2 ** 53 }],
    ["массив", [{ valid: true, credentialVersion: 2 }]],
  ])("malformed proof (%s): отказ, finish(false) один раз, без cookie и без старого порта", async (_label, proof) => {
    const { ports, events } = harness(() => proof as unknown as AdminPasswordProof);
    const response = await createAdminHandler(ports)(loginRequest());

    expectNoCookie(response);
    expect(response?.headers.get("location")).toBe("/admin/login?error=security");
    expect(ports.finish).toHaveBeenCalledTimes(1);
    expect(ports.finish).toHaveBeenCalledWith("reservation-1", false);
    expect(events).not.toContain("version");
    expect(ports.verifyPassword).not.toHaveBeenCalled();
  });

  it("ошибка нового порта: finish(false) один раз, fallback на старый порт запрещён", async () => {
    const { ports, events } = harness(() => {
      throw new Error("reader outage");
    });
    const response = await createAdminHandler(ports)(loginRequest());

    expectNoCookie(response);
    expect(response?.headers.get("location")).toBe("/admin/login?error=security");
    expect(events).toEqual(["reserve", "proof", "finish"]);
    expect(ports.finish).toHaveBeenCalledWith("reservation-1", false);
    expect(ports.verifyPassword).not.toHaveBeenCalled();
    expect(ports.credentialVersion).not.toHaveBeenCalled();
  });

  it("сбой finish после успешного доказательства: cookie нет, версия не запрашивается", async () => {
    const { ports } = harness(() => ({ valid: true, credentialVersion: 2 }));
    ports.finish = vi.fn(async () => {
      throw new Error("finish down");
    });
    const response = await createAdminHandler(ports)(loginRequest());

    expectNoCookie(response);
    expect(response?.headers.get("location")).toBe("/admin/login?error=security");
    expect(ports.finish).toHaveBeenCalledTimes(1);
    expect(ports.credentialVersion).not.toHaveBeenCalled();
  });

  it("rate limit после finish: перенаправление с ожиданием, cookie нет", async () => {
    const { ports } = harness(() => ({ valid: true, credentialVersion: 2 }));
    ports.finish = vi.fn(async () => 30);
    const response = await createAdminHandler(ports)(loginRequest());

    expectNoCookie(response);
    expect(response?.headers.get("location")).toBe("/admin/login?error=rate&retry=30");
    expect(ports.credentialVersion).not.toHaveBeenCalled();
  });

  it("ошибка сверки текущей версии после finish: cookie нет", async () => {
    const { ports } = harness(() => ({ valid: true, credentialVersion: 2 }));
    ports.credentialVersion = vi.fn(async () => {
      throw new Error("version outage");
    });
    const response = await createAdminHandler(ports)(loginRequest());

    expectNoCookie(response);
    expect(response?.headers.get("location")).toBe("/admin/login?error=security");
    expect(ports.finish).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1.5, Number.NaN])("некорректная текущая версия %s: cookie нет", async (bad) => {
    const { ports } = harness(() => ({ valid: true, credentialVersion: 2 }));
    ports.credentialVersion = vi.fn(async () => bad);
    expectNoCookie(await createAdminHandler(ports)(loginRequest()));
  });

  it("отказ резервации: ни доказательство, ни старый порт не вызываются", async () => {
    const { ports } = harness(() => ({ valid: true, credentialVersion: 2 }));
    ports.reserve = vi.fn(async () => ({ allowed: false, retryAfter: 12, reservationId: null }));
    const response = await createAdminHandler(ports)(loginRequest());

    expectNoCookie(response);
    expect(ports.verifyPasswordWithVersion).not.toHaveBeenCalled();
    expect(ports.verifyPassword).not.toHaveBeenCalled();
  });

  it("позднейшая смена версии инвалидирует выпущенную сессию при следующем защищённом запросе", async () => {
    const { ports, current } = harness(() => ({ valid: true, credentialVersion: 2 }));
    const handler = createAdminHandler(ports);
    const login = await handler(loginRequest());
    const token = /admin_session=([^;]+)/.exec(login?.headers.get("set-cookie") ?? "")?.[1];
    expect(token).toBeTruthy();

    const before = await handler(new Request(`${ORIGIN}/admin`, { headers: { cookie: `admin_session=${token}` } }));
    expect(before?.status).toBe(200);

    current.version = 3;
    vi.mocked(ports.assets.fetch).mockClear();
    const after = await handler(new Request(`${ORIGIN}/admin`, { headers: { cookie: `admin_session=${token}` } }));
    expect(after?.status).toBe(302);
    expect(after?.headers.get("location")).toBe("/admin/login?session=expired");
    expect(after?.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(ports.assets.fetch).not.toHaveBeenCalled();
  });
});

describe("адаптеры без нового порта", () => {
  it("прежний путь: verifyPassword, finish, затем credentialVersion", async () => {
    const { ports, events } = harness(() => ({ valid: false }), { verifyPasswordWithVersion: undefined });
    const response = await createAdminHandler(ports)(loginRequest());

    expect(response?.headers.get("location")).toBe("/admin");
    expect(await cookieVersion(response)).toBe(2);
    expect(events).toEqual(["reserve", "legacy-verify", "finish", "version"]);
  });
});

describe("legacy verifier: доказательство за одно чтение состояния", () => {
  function verifierOf(states: (LegacyCredentialState | Error)[], env: string | undefined = FIXTURE_ENV_PASSWORD) {
    const queue = [...states];
    const readCredentialState = vi.fn(async () => {
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      if (next instanceof Error) throw next;
      return next;
    });
    const readEnvPassword = vi.fn(() => env);
    return { verifier: createLegacyPasswordVerifier({ readCredentialState, readEnvPassword }), readCredentialState, readEnvPassword };
  }
  const HASH_V2: LegacyCredentialState = { passwordHash: GOLDEN_PBKDF2_HASH, sessionVersion: 2 };
  const HASH_V3: LegacyCredentialState = { passwordHash: GOLDEN_PBKDF2_HASH, sessionVersion: 3 };
  const EMPTY: LegacyCredentialState = { passwordHash: null, sessionVersion: 1 };

  async function code(promise: Promise<unknown>) {
    const error = await promise.then(() => { throw new Error("expected rejection"); }, (reason: unknown) => reason);
    expect(error).toBeInstanceOf(LegacyPasswordVerifierError);
    return (error as LegacyPasswordVerifierError).code;
  }

  it("хеш: одно чтение, версия того же состояния; env не читается", async () => {
    const { verifier, readCredentialState, readEnvPassword } = verifierOf([HASH_V2, HASH_V3]);
    await expect(verifier.verifyPasswordWithVersion!(GOLDEN_HASH_PASSWORD)).resolves.toEqual({ valid: true, credentialVersion: 2 });
    expect(readCredentialState).toHaveBeenCalledTimes(1);
    expect(readEnvPassword).not.toHaveBeenCalled();
  });

  it("пустая строка: env-пароль принимается с версией 1 за одно чтение", async () => {
    const { verifier, readCredentialState } = verifierOf([EMPTY]);
    await expect(verifier.verifyPasswordWithVersion!(FIXTURE_ENV_PASSWORD)).resolves.toEqual({ valid: true, credentialVersion: 1 });
    expect(readCredentialState).toHaveBeenCalledTimes(1);
  });

  it("сохраняет версию прочитанного состояния, даже если env reader изменил исходный объект", async () => {
    const shared = { passwordHash: null, sessionVersion: 1 };
    const readCredentialState = vi.fn(async () => shared);
    const verifier = createLegacyPasswordVerifier({
      readCredentialState,
      readEnvPassword: () => {
        shared.sessionVersion = 2;
        return FIXTURE_ENV_PASSWORD;
      },
    });
    await expect(verifier.verifyPasswordWithVersion(FIXTURE_ENV_PASSWORD)).resolves.toEqual({ valid: true, credentialVersion: 1 });
    expect(readCredentialState).toHaveBeenCalledTimes(1);
  });

  it("неверный пароль → { valid: false } без версии", async () => {
    const { verifier } = verifierOf([HASH_V2]);
    const proof = await verifier.verifyPasswordWithVersion!(FIXTURE_WRONG_PASSWORD);
    expect(proof).toEqual({ valid: false });
    const env = verifierOf([EMPTY]);
    expect(await env.verifier.verifyPasswordWithVersion!(FIXTURE_WRONG_PASSWORD)).toEqual({ valid: false });
  });

  it("env-пароль против строки с хешем → { valid: false }, без fallback", async () => {
    const { verifier, readEnvPassword } = verifierOf([HASH_V2]);
    expect(await verifier.verifyPasswordWithVersion!(FIXTURE_ENV_PASSWORD)).toEqual({ valid: false });
    expect(readEnvPassword).not.toHaveBeenCalled();
  });

  it("повреждённый хеш → { valid: false } даже для env-пароля", async () => {
    const { verifier, readEnvPassword } = verifierOf([{ passwordHash: MALFORMED_HASH, sessionVersion: 2 }]);
    expect(await verifier.verifyPasswordWithVersion!(FIXTURE_ENV_PASSWORD)).toEqual({ valid: false });
    expect(readEnvPassword).not.toHaveBeenCalled();
  });

  it("сбой reader → отказ с кодом, env не читается", async () => {
    const { verifier, readEnvPassword } = verifierOf([new Error("outage db-host")]);
    expect(await code(verifier.verifyPasswordWithVersion!(FIXTURE_ENV_PASSWORD))).toBe("credential_state_unavailable");
    expect(readEnvPassword).not.toHaveBeenCalled();
  });

  it("невалидное состояние → отказ с кодом", async () => {
    const { verifier, readEnvPassword } = verifierOf([{ passwordHash: "", sessionVersion: 1 } as LegacyCredentialState]);
    expect(await code(verifier.verifyPasswordWithVersion!(FIXTURE_ENV_PASSWORD))).toBe("credential_state_invalid");
    expect(readEnvPassword).not.toHaveBeenCalled();
  });

  it("небезопасный env при пустой строке → отказ с кодом", async () => {
    const { verifier } = verifierOf([EMPTY], "short");
    expect(await code(verifier.verifyPasswordWithVersion!("short"))).toBe("env_password_unavailable");
  });

  it("сбой PBKDF2 → отказ с кодом, без fallback на env", async () => {
    const spy = vi.spyOn(crypto.subtle, "deriveBits").mockRejectedValue(new DOMException("limit", "NotSupportedError"));
    try {
      const { verifier, readEnvPassword } = verifierOf([HASH_V2]);
      expect(await code(verifier.verifyPasswordWithVersion!(GOLDEN_HASH_PASSWORD))).toBe("password_hash_verification_failed");
      expect(readEnvPassword).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("каждый вызов читает состояние заново, без кэша", async () => {
    const { verifier, readCredentialState } = verifierOf([HASH_V2, HASH_V3]);
    await expect(verifier.verifyPasswordWithVersion!(GOLDEN_HASH_PASSWORD)).resolves.toEqual({ valid: true, credentialVersion: 2 });
    await expect(verifier.verifyPasswordWithVersion!(GOLDEN_HASH_PASSWORD)).resolves.toEqual({ valid: true, credentialVersion: 3 });
    expect(readCredentialState).toHaveBeenCalledTimes(2);
  });

  it("прежние методы не изменились", async () => {
    const { verifier } = verifierOf([HASH_V2]);
    await expect(verifier.verifyPassword(GOLDEN_HASH_PASSWORD)).resolves.toBe(true);
    await expect(verifier.credentialVersion()).resolves.toBe(2);
  });
});

describe("handler + legacy verifier против меняющегося состояния", () => {
  function race() {
    const database: { state: LegacyCredentialState } = { state: { passwordHash: GOLDEN_PBKDF2_HASH, sessionVersion: 2 } };
    const reads: string[] = [];
    const verifier = createLegacyPasswordVerifier({
      readCredentialState: async () => {
        reads.push("read");
        return { ...database.state };
      },
      readEnvPassword: () => FIXTURE_ENV_PASSWORD,
    });
    return { database, reads, verifier };
  }
  function portsFrom(verifier: ReturnType<typeof race>["verifier"], onFinish: () => void): AdminAuthPorts {
    return {
      reserve: async () => ({ allowed: true, retryAfter: 0, reservationId: "r1" }),
      finish: vi.fn(async () => { onFinish(); return 0; }),
      ...verifier,
      assets: { fetch: async () => new Response("ok", { headers: { "content-type": "text/html" } }) },
      secret: SECRET,
      clientIp: "203.0.113.20",
      now: () => NOW,
    };
  }

  it("пароль сменили во время finish: старый пароль не получает cookie новой версии", async () => {
    const { database, reads, verifier } = race();
    const ports = portsFrom(verifier, () => {
      database.state = { passwordHash: GOLDEN_PBKDF2_HASH, sessionVersion: 3 };
    });
    const response = await createAdminHandler(ports)(loginRequest(GOLDEN_HASH_PASSWORD));

    expectNoCookie(response);
    expect(response?.headers.get("location")).toBe("/admin/login?error=security");
    expect(reads).toHaveLength(2); // одно чтение на проверку, одно на сверку после finish
  });

  it("без смены: cookie версии проверенного состояния", async () => {
    const { reads, verifier } = race();
    const response = await createAdminHandler(portsFrom(verifier, () => {}))(loginRequest(GOLDEN_HASH_PASSWORD));

    expect(response?.headers.get("location")).toBe("/admin");
    expect(await cookieVersion(response)).toBe(2);
    expect(reads).toHaveLength(2);
  });

  it("изменение общего объекта во время PBKDF2 не выдаёт cookie новой версии по старому хешу", async () => {
    const shared = { passwordHash: GOLDEN_PBKDF2_HASH, sessionVersion: 2 };
    const readCredentialState = vi.fn(async () => shared);
    const verifier = createLegacyPasswordVerifier({ readCredentialState, readEnvPassword: () => FIXTURE_ENV_PASSWORD });
    const deriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
    const spy = vi.spyOn(crypto.subtle, "deriveBits").mockImplementation((algorithm, key, length) => {
      shared.passwordHash = MALFORMED_HASH;
      shared.sessionVersion = 3;
      return deriveBits(algorithm, key, length);
    });
    try {
      const response = await createAdminHandler(portsFrom(verifier, () => {}))(loginRequest(GOLDEN_HASH_PASSWORD));
      expectNoCookie(response);
      expect(response?.headers.get("location")).toBe("/admin/login?error=security");
      expect(readCredentialState).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("характеристика прежнего раздельного пути: смена версии между вызовами выдаёт cookie новой версии", async () => {
    // Показывает, зачем нужен новый порт. Разделяем возвращаемые методы verifier
    // вручную, как это делал бы адаптер без verifyPasswordWithVersion.
    const { database, verifier } = race();
    const ports = portsFrom(verifier, () => {});
    delete (ports as { verifyPasswordWithVersion?: unknown }).verifyPasswordWithVersion;
    const originalVerify = ports.verifyPassword;
    ports.verifyPassword = async (password) => {
      const result = await originalVerify(password);
      database.state = { passwordHash: "x", sessionVersion: 3 };
      return result;
    };
    const response = await createAdminHandler(ports)(loginRequest(GOLDEN_HASH_PASSWORD));

    expect(await cookieVersion(response)).toBe(3);
  });

  it("сбой reader и пустая строка не открывают env-fallback при outage", async () => {
    const verifier = createLegacyPasswordVerifier({
      readCredentialState: async () => { throw new Error("outage"); },
      readEnvPassword: () => FIXTURE_ENV_PASSWORD,
    });
    const response = await createAdminHandler(portsFrom(verifier, () => {}))(loginRequest(FIXTURE_ENV_PASSWORD));

    expectNoCookie(response);
    expect(response?.headers.get("location")).toBe("/admin/login?error=security");
  });
});
