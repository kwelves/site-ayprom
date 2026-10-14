import { pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  constantTimePasswordEqual,
  hashAdminPassword,
  validateNewAdminPassword,
  verifyAdminPasswordHash,
} from "@/lib/admin/password-credential";
import { GOLDEN_HASH_PASSWORD, GOLDEN_PBKDF2_HASH } from "./support/legacy-password-verifier-fixtures";

describe("хранение пароля администратора", () => {
  it("создаёт salted PBKDF2-хеш и проверяет только исходный пароль", async () => {
    const password = "Очень-надёжный-пароль-2026";
    const hash = await hashAdminPassword(password);

    expect(hash).not.toContain(password);
    expect(hash.startsWith("pbkdf2-sha256-chain:100000x6:")).toBe(true);
    expect(await verifyAdminPasswordHash(password, hash)).toBe(true);
    expect(await verifyAdminPasswordHash("другой-пароль", hash)).toBe(false);
  });

  it("новый хеш совпадает с независимым расчётом: шесть проходов по 100 000, соль каждого прохода — результат прошлого", async () => {
    const password = "Проверка-цепочки-2026";
    const [, , saltPart] = (await hashAdminPassword(password)).split(":");
    const salt = Buffer.from(saltPart, "base64url");
    const fromHash = (hash: string) => hash.split(":")[3];
    let current: Buffer = salt;
    for (let round = 0; round < 6; round += 1) current = pbkdf2Sync(password, current, 100_000, 32, "sha256");
    const encoded = ["pbkdf2-sha256-chain", "100000x6", saltPart, current.toString("base64url")].join(":");
    expect(fromHash(encoded)).toBe(current.toString("base64url"));
    expect(await verifyAdminPasswordHash(password, encoded)).toBe(true);
    expect(await verifyAdminPasswordHash(password + "!", encoded)).toBe(false);
  });

  it("по-прежнему проверяет старый хеш из 600 000 итераций (в Node)", async () => {
    expect(await verifyAdminPasswordHash(GOLDEN_HASH_PASSWORD, GOLDEN_PBKDF2_HASH)).toBe(true);
    expect(await verifyAdminPasswordHash("не-тот-пароль", GOLDEN_PBKDF2_HASH)).toBe(false);
  });

  it("не принимает цепочку с другими параметрами или повреждённой частью", async () => {
    const hash = await hashAdminPassword("Ещё-пароль-для-проверки");
    const [algorithm, , salt, digest] = hash.split(":");
    expect(await verifyAdminPasswordHash("Ещё-пароль-для-проверки", [algorithm, "100000x1", salt, digest].join(":"))).toBe(false);
    expect(await verifyAdminPasswordHash("Ещё-пароль-для-проверки", [algorithm, "100000x6", salt, digest, "extra"].join(":"))).toBe(false);
    expect(await verifyAdminPasswordHash("Ещё-пароль-для-проверки", [algorithm, "100000x6", salt, digest.slice(1)].join(":"))).toBe(false);
  });

  it("создаёт разные хеши для одного пароля благодаря случайной соли", async () => {
    const password = "Ещё-один-надёжный-пароль";
    expect(await hashAdminPassword(password)).not.toBe(await hashAdminPassword(password));
  });

  it("отклоняет повреждённый или неподдерживаемый формат хеша", async () => {
    expect(await verifyAdminPasswordHash("secret", "sha256:1:broken:hash")).toBe(false);
    expect(await verifyAdminPasswordHash("secret", "pbkdf2-sha256:999999999:broken:hash")).toBe(false);
  });

  it("сравнивает исходный пароль без утечки через ранний выход", async () => {
    expect(await constantTimePasswordEqual("одинаковый", "одинаковый")).toBe(true);
    expect(await constantTimePasswordEqual("первый", "второй")).toBe(false);
  });

  it("проверяет длину и подтверждение нового пароля", () => {
    expect(validateNewAdminPassword("короткий", "короткий")).toContain("не менее 12");
    expect(validateNewAdminPassword("надёжный-пароль", "другое-подтверждение")).toContain("не совпадают");
    expect(validateNewAdminPassword("надёжный-пароль", "надёжный-пароль")).toBeNull();
  });
});
