import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// QA-005: порядок операций и есть вся суть исправления.
//
// Раньше `verifyAdminPassword` (PBKDF2 — намеренно дорогая функция) вызывался
// ДО проверки лимита, поэтому заблокированный перебирающий всё равно заставлял
// сервер считать хеш на каждом запросе: защита работала усилителем нагрузки.
//
// Контракт брони доказан в БД (admin_auth_reservation.test.sql). Здесь
// проверяется прикладная половина, которую БД увидеть не может: что бронь
// берётся раньше хеша и что заблокированный запрос уходит до него.
//
// Переводы строк нормализуются: Git на Windows отдаёт файл с CRLF.
const source = readFileSync(path.join(process.cwd(), "src/lib/admin/actions.ts"), "utf8").replace(
  /\r\n/g,
  "\n",
);

function actionBody(name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  expect(start, `действие ${name} не найдено`).toBeGreaterThan(-1);
  const end = source.indexOf("\n}\n", start);
  expect(end, `не найден конец действия ${name}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe.each([
  ["login", "вход"],
  ["changeAdminPassword", "смена пароля"],
])("%s: бронь берётся до проверки пароля", (action) => {
  const body = actionBody(action);

  it("вызывает beginAuthAttempt раньше verifyAdminPassword", () => {
    const begin = body.indexOf("beginAuthAttempt");
    const verify = body.indexOf("verifyAdminPassword");

    expect(begin, "beginAuthAttempt отсутствует").toBeGreaterThan(-1);
    expect(verify, "verifyAdminPassword отсутствует").toBeGreaterThan(-1);
    expect(begin).toBeLessThan(verify);
  });

  it("завершает бронь после проверки пароля", () => {
    const verify = body.indexOf("verifyAdminPassword");
    const finish = body.indexOf("finishAuthAttempt");

    expect(finish, "finishAuthAttempt отсутствует").toBeGreaterThan(-1);
    expect(finish).toBeGreaterThan(verify);
  });

  // Ключевое: отказ по лимиту должен произойти РАНЬШЕ хеша, иначе дорогая
  // работа всё равно выполняется и смысл исправления теряется.
  it("выходит по отказу брони до вычисления хеша", () => {
    const guard = body.indexOf("reservation.allowed");
    const verify = body.indexOf("verifyAdminPassword");

    expect(guard, "нет проверки выданной брони").toBeGreaterThan(-1);
    expect(guard).toBeLessThan(verify);
  });

  it("не использует прежний post-verification учёт", () => {
    expect(body).not.toContain("registerLoginAttempt");
  });
});
