import { describe, expect, it } from "vitest";
import {
  constantTimePasswordEqual,
  hashAdminPassword,
  validateNewAdminPassword,
  verifyAdminPasswordHash,
} from "@/lib/admin/password-credential";

describe("хранение пароля администратора", () => {
  it("создаёт salted PBKDF2-хеш и проверяет только исходный пароль", async () => {
    const password = "Очень-надёжный-пароль-2026";
    const hash = await hashAdminPassword(password);

    expect(hash).not.toContain(password);
    expect(hash.startsWith("pbkdf2-sha256:600000:")).toBe(true);
    expect(await verifyAdminPasswordHash(password, hash)).toBe(true);
    expect(await verifyAdminPasswordHash("другой-пароль", hash)).toBe(false);
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
