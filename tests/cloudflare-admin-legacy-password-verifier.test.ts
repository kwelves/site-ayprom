import { pbkdf2Sync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LegacyPasswordVerifierError,
  createLegacyPasswordVerifier,
  type LegacyCredentialState,
} from "@/cloudflare/admin/legacy-password-verifier";
import { verifyAdminPasswordHash } from "@/lib/admin/password-credential";
import { requireServerEnv } from "@/lib/env";
import {
  FIXTURE_ENV_PASSWORD,
  FIXTURE_UNICODE_ENV_PASSWORD,
  FIXTURE_WRONG_PASSWORD,
  GOLDEN_HASH_PASSWORD,
  GOLDEN_PBKDF2_HASH,
  GOLDEN_SALT_BYTES,
  MALFORMED_HASH,
} from "./support/legacy-password-verifier-fixtures";

// Rest parameter, not a default: an explicit `undefined` must reach the
// verifier as a missing env secret instead of being replaced by the fixture.
function setup(
  state: LegacyCredentialState | (() => Promise<LegacyCredentialState>),
  ...env: [envPassword?: string | undefined]
) {
  const envPassword = env.length > 0 ? env[0] : FIXTURE_ENV_PASSWORD;
  const readCredentialState = vi.fn(typeof state === "function" ? state : async () => state);
  const readEnvPassword = vi.fn(() => envPassword);
  return { verifier: createLegacyPasswordVerifier({ readCredentialState, readEnvPassword }), readCredentialState, readEnvPassword };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LegacyPasswordVerifierError);
    return (error as LegacyPasswordVerifierError).code;
  }
  throw new Error("expected rejection");
}

const EMPTY_ROW: LegacyCredentialState = { passwordHash: null, sessionVersion: 1 };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("golden fixture", () => {
  it("совпадает с независимым node:crypto PBKDF2 и понимается существующим verifyAdminPasswordHash", async () => {
    const [, , , hash] = GOLDEN_PBKDF2_HASH.split(":");
    const independent = pbkdf2Sync(GOLDEN_HASH_PASSWORD, Buffer.from(GOLDEN_SALT_BYTES), 600_000, 32, "sha256");
    expect(independent.toString("base64url")).toBe(hash);
    await expect(verifyAdminPasswordHash(GOLDEN_HASH_PASSWORD, GOLDEN_PBKDF2_HASH)).resolves.toBe(true);
  });
});

describe("env-пароль при явно пустой строке учётных данных (passwordHash: null)", () => {
  it("принимает правильный и отвергает неправильный пароль", async () => {
    const { verifier } = setup(EMPTY_ROW);
    await expect(verifier.verifyPassword(FIXTURE_ENV_PASSWORD)).resolves.toBe(true);
    await expect(verifier.verifyPassword(FIXTURE_WRONG_PASSWORD)).resolves.toBe(false);
    await expect(verifier.verifyPassword("")).resolves.toBe(false);
  });

  it("сравнивает Unicode побайтно, без нормализации", async () => {
    const { verifier } = setup(EMPTY_ROW, FIXTURE_UNICODE_ENV_PASSWORD);
    await expect(verifier.verifyPassword(FIXTURE_UNICODE_ENV_PASSWORD)).resolves.toBe(true);
    await expect(verifier.verifyPassword(FIXTURE_UNICODE_ENV_PASSWORD.normalize("NFD"))).resolves.toBe(false);
  });

  it.each([
    ["отсутствует", undefined],
    ["пустой", ""],
    ["короче 12 байт", "short-11byt"],
    ["5 кириллических символов = 10 байт", "абвгд"],
    ["документированный плейсхолдер", "replace-with-a-long-random-password"],
    ["типовой плейсхолдер", "change-me-please-now"],
  ])("небезопасный env (%s) — отказ с кодом, а не false", async (_label, env) => {
    const { verifier } = setup(EMPTY_ROW, env);
    expect(await codeOf(verifier.verifyPassword(env ?? "anything-here-long"))).toBe("env_password_unavailable");
  });

  it("исключение геттера env превращается в отказ с кодом", async () => {
    const verifier = createLegacyPasswordVerifier({
      readCredentialState: async () => EMPTY_ROW,
      readEnvPassword: () => {
        throw new Error("binding broke");
      },
    });
    expect(await codeOf(verifier.verifyPassword(FIXTURE_ENV_PASSWORD))).toBe("env_password_unavailable");
  });

  it("политика env совпадает с requireServerEnv('ADMIN_PASSWORD')", async () => {
    for (const candidate of [
      "short-11byt",
      "exactly-12-b",
      "абвгд",
      "абвгдеж",
      "replace-with-a-long-random-password",
      "REPLACE-WITH-A-LONG-RANDOM-PASSWORD",
      "changeme-long-value",
      "placeholder_value_long",
      "example",
      FIXTURE_ENV_PASSWORD,
      FIXTURE_UNICODE_ENV_PASSWORD,
    ]) {
      vi.stubEnv("ADMIN_PASSWORD", candidate);
      let legacyAccepts = true;
      try {
        requireServerEnv("ADMIN_PASSWORD");
      } catch {
        legacyAccepts = false;
      }
      const { verifier } = setup(EMPTY_ROW, candidate);
      let adapterAccepts = true;
      try {
        await verifier.verifyPassword(candidate);
      } catch {
        adapterAccepts = false;
      }
      expect(adapterAccepts, candidate).toBe(legacyAccepts);
    }
  });
});

describe("хеш в строке учётных данных", () => {
  it("проверяет только хеш; env не читается и не принимается", async () => {
    const { verifier, readEnvPassword } = setup({ passwordHash: GOLDEN_PBKDF2_HASH, sessionVersion: 2 });
    await expect(verifier.verifyPassword(GOLDEN_HASH_PASSWORD)).resolves.toBe(true);
    await expect(verifier.verifyPassword(FIXTURE_ENV_PASSWORD)).resolves.toBe(false);
    await expect(verifier.verifyPassword(FIXTURE_WRONG_PASSWORD)).resolves.toBe(false);
    expect(readEnvPassword).not.toHaveBeenCalled();
  });

  it("работает и при отсутствующем/коротком env", async () => {
    const { verifier } = setup({ passwordHash: GOLDEN_PBKDF2_HASH, sessionVersion: 2 }, undefined);
    await expect(verifier.verifyPassword(GOLDEN_HASH_PASSWORD)).resolves.toBe(true);
  });

  it("повреждённый хеш — false даже для правильного env-пароля", async () => {
    const { verifier, readEnvPassword } = setup({ passwordHash: MALFORMED_HASH, sessionVersion: 2 });
    await expect(verifier.verifyPassword(FIXTURE_ENV_PASSWORD)).resolves.toBe(false);
    await expect(verifier.verifyPassword(GOLDEN_HASH_PASSWORD)).resolves.toBe(false);
    expect(readEnvPassword).not.toHaveBeenCalled();
  });

  it("сбой PBKDF2 в runtime (напр. лимит итераций) — отказ с кодом, без fallback на env", async () => {
    vi.spyOn(crypto.subtle, "deriveBits").mockRejectedValue(new DOMException("iterations not supported", "NotSupportedError"));
    const { verifier, readEnvPassword } = setup({ passwordHash: GOLDEN_PBKDF2_HASH, sessionVersion: 2 });
    expect(await codeOf(verifier.verifyPassword(FIXTURE_ENV_PASSWORD))).toBe("password_hash_verification_failed");
    expect(readEnvPassword).not.toHaveBeenCalled();
  });
});

describe("невалидное состояние и сбой backend не дают fallback", () => {
  it.each([
    ["sessionVersion 0", { passwordHash: null, sessionVersion: 0 }],
    ["отрицательная версия", { passwordHash: null, sessionVersion: -1 }],
    ["дробная версия", { passwordHash: null, sessionVersion: 1.5 }],
    ["NaN", { passwordHash: null, sessionVersion: Number.NaN }],
    ["строка вместо версии", { passwordHash: null, sessionVersion: "2" }],
    ["за пределами safe integer", { passwordHash: null, sessionVersion: Number.MAX_SAFE_INTEGER + 1 }],
    ["нет версии", { passwordHash: null }],
    ["passwordHash отсутствует (undefined)", { sessionVersion: 1 }],
    ["пустая строка хеша", { passwordHash: "", sessionVersion: 1 }],
    ["хеш не строка", { passwordHash: 42, sessionVersion: 1 }],
    ["state null", null],
  ])("%s", async (_label, state) => {
    const { verifier, readEnvPassword } = setup(async () => state as unknown as LegacyCredentialState);
    expect(await codeOf(verifier.verifyPassword(FIXTURE_ENV_PASSWORD))).toBe("credential_state_invalid");
    expect(await codeOf(verifier.credentialVersion())).toBe("credential_state_invalid");
    expect(readEnvPassword).not.toHaveBeenCalled();
  });

  it("сбой reader — отказ с кодом, без утечки деталей backend и без логов", async () => {
    const logSpies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    const { verifier, readEnvPassword } = setup(async () => {
      throw new Error(`db-host secret-backend-detail ${FIXTURE_ENV_PASSWORD}`);
    });

    for (const attempt of [verifier.verifyPassword(FIXTURE_ENV_PASSWORD), verifier.credentialVersion()]) {
      try {
        await attempt;
        throw new Error("expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(LegacyPasswordVerifierError);
        expect((error as LegacyPasswordVerifierError).code).toBe("credential_state_unavailable");
        expect((error as Error).cause).toBeUndefined();
        const serialized = `${(error as Error).message} ${JSON.stringify(error)} ${String(error)}`;
        expect(serialized).not.toMatch(/db-host|secret-backend-detail|fixture-env-password/);
      }
    }
    expect(readEnvPassword).not.toHaveBeenCalled();
    for (const spy of logSpies) expect(spy).not.toHaveBeenCalled();
  });

  it("ни один путь отказа не пишет в консоль и не включает секреты в сообщение", async () => {
    const logSpies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    const failures: Promise<unknown>[] = [
      setup(EMPTY_ROW, "short").verifier.verifyPassword("short"),
      setup({ passwordHash: "", sessionVersion: 1 }).verifier.verifyPassword(FIXTURE_ENV_PASSWORD),
    ];
    for (const failure of failures) {
      await failure.catch((error: Error) => {
        expect(error.message).not.toContain(FIXTURE_ENV_PASSWORD);
        expect(error.message).not.toContain("short");
      });
    }
    await setup(EMPTY_ROW).verifier.verifyPassword(FIXTURE_WRONG_PASSWORD);
    await setup({ passwordHash: MALFORMED_HASH, sessionVersion: 3 }).verifier.verifyPassword(FIXTURE_ENV_PASSWORD);
    for (const spy of logSpies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("состояние читается заново при каждом вызове", () => {
  it("смена env → хеш и рост версии видны сразу, без кэша", async () => {
    const states: LegacyCredentialState[] = [
      { passwordHash: null, sessionVersion: 1 },
      { passwordHash: null, sessionVersion: 1 },
      { passwordHash: GOLDEN_PBKDF2_HASH, sessionVersion: 2 },
      { passwordHash: GOLDEN_PBKDF2_HASH, sessionVersion: 2 },
      { passwordHash: GOLDEN_PBKDF2_HASH, sessionVersion: 3 },
    ];
    let index = 0;
    const { verifier, readCredentialState } = setup(async () => states[index++]);

    await expect(verifier.verifyPassword(FIXTURE_ENV_PASSWORD)).resolves.toBe(true);
    await expect(verifier.credentialVersion()).resolves.toBe(1);
    await expect(verifier.verifyPassword(FIXTURE_ENV_PASSWORD)).resolves.toBe(false);
    await expect(verifier.credentialVersion()).resolves.toBe(2);
    await expect(verifier.credentialVersion()).resolves.toBe(3);
    expect(readCredentialState).toHaveBeenCalledTimes(5);
  });

  it("два verifier'а не делят состояние", async () => {
    const first = setup(EMPTY_ROW, FIXTURE_ENV_PASSWORD).verifier;
    const second = setup(EMPTY_ROW, FIXTURE_UNICODE_ENV_PASSWORD).verifier;
    await expect(first.verifyPassword(FIXTURE_ENV_PASSWORD)).resolves.toBe(true);
    await expect(second.verifyPassword(FIXTURE_ENV_PASSWORD)).resolves.toBe(false);
  });
});
