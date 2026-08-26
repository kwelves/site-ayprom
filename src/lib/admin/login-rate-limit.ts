import "server-only";

import { headers } from "next/headers";
import * as Sentry from "@sentry/nextjs";
import { requireServerEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export class AdminLoginProtectionUnavailableError extends Error {
  constructor() {
    super("Защита входа временно недоступна. Повторите попытку через несколько секунд.");
    this.name = "AdminLoginProtectionUnavailableError";
  }
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function getAttemptKeyHash(scope: "login" | "password-change"): Promise<string> {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwardedFor || requestHeaders.get("x-real-ip") || "unknown";
  const secret = requireServerEnv("ADMIN_SESSION_SECRET");
  const digest = await sha256(`${secret}:${scope}:${address}`);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Сколько живёт бронь. PBKDF2 занимает доли секунды; 30 с — запас на медленный
 * запрос. Просроченная бронь означает, что процесс не вернулся, и при следующей
 * попытке того же ключа будет засчитана как неудача.
 */
const RESERVATION_TTL_SECONDS = 30;

/**
 * Сколько попыток этого ключа одновременно допускается к проверке пароля.
 * Без такого бюджета параллельный залп успел бы пройти проверку счётчика до
 * того, как хоть одна попытка его увеличила.
 */
const MAX_CONCURRENT_ATTEMPTS = 3;

export interface AuthAttemptReservation {
  allowed: boolean;
  /** Секунды до следующей разрешённой попытки; 0, когда попытка разрешена. */
  retryAfter: number;
  reservationId: string | null;
}

function failClosed(error: { code?: string; message?: string }, what: string): never {
  // 42883 намеренно широк: он покрывает и «функции нет», и «оператора нет».
  // Именно эта широта однажды скрыла настоящую ошибку — RPC существовал, но
  // падал на каждом вызове, а вызывающий читал это как «ещё не развёрнут» и
  // тихо деградировал, из-за чего защита от перебора не работала вовсе.
  Sentry.captureMessage(`${what} RPC unavailable — admin auth denied fail-closed`, {
    level: "error",
    tags: { subsystem: "admin-auth", fallback: "fail-closed" },
    extra: { postgrestCode: error.code, message: error.message },
  });
  throw new AdminLoginProtectionUnavailableError();
}

/**
 * QA-005: бронь берётся ДО проверки пароля.
 *
 * Раньше сначала считался PBKDF2, и только потом проверялся лимит — то есть
 * заблокированный перебирающий всё равно расходовал дорогой хеш на каждом
 * запросе. Теперь заблокированный запрос не доходит до вычислений.
 */
export async function beginAuthAttempt(
  scope: "login" | "password-change" = "login",
): Promise<AuthAttemptReservation> {
  const keyHash = await getAttemptKeyHash(scope);
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .rpc("begin_admin_auth_attempt", {
      p_key_hash: keyHash,
      p_scope: scope,
      p_ttl_seconds: RESERVATION_TTL_SECONDS,
      p_max_concurrent: MAX_CONCURRENT_ATTEMPTS,
    })
    .single<{ out_allowed: boolean; out_retry_after: number; out_reservation_id: string | null }>();

  if (error?.code === "PGRST202" || error?.code === "42883") failClosed(error, "begin_admin_auth_attempt");
  if (error) throw new Error("Не удалось проверить ограничение входа.");

  return {
    allowed: data.out_allowed === true,
    retryAfter: typeof data.out_retry_after === "number" ? data.out_retry_after : 0,
    reservationId: data.out_reservation_id,
  };
}

/**
 * Завершение брони после проверки пароля. Идемпотентно на стороне БД: повтор с
 * тем же идентификатором не учитывается второй раз.
 */
export async function finishAuthAttempt(
  reservationId: string,
  passwordIsValid: boolean,
): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("finish_admin_auth_attempt", {
    p_reservation_id: reservationId,
    p_password_is_valid: passwordIsValid,
  });

  if (error?.code === "PGRST202" || error?.code === "42883") failClosed(error, "finish_admin_auth_attempt");
  // Незавершаемая бронь означает потерянный учёт попытки. Закрываемся
  // fail-closed: молчаливый пропуск выглядел бы для перебирающего как успех.
  if (error) throw new AdminLoginProtectionUnavailableError();

  return typeof data === "number" ? data : 0;
}

export async function registerLoginAttempt(
  passwordIsValid: boolean,
  scope: "login" | "password-change" = "login",
): Promise<number> {
  const keyHash = await getAttemptKeyHash(scope);
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("register_admin_login_attempt", {
    attempt_key_hash: keyHash,
    password_is_valid: passwordIsValid,
    attempt_scope: scope,
  });

  // 42883 is deliberately broad: it covers both "function does not exist" and
  // "operator does not exist". That breadth is what let a real bug hide here
  // for months — the RPC existed but raised 42883 on every call because a
  // variable was named `current_time`, a reserved keyword, so every comparison
  // failed on a type mismatch. The caller read that as "not deployed yet" and
  // quietly degraded, meaning brute-force protection never actually ran.
  //
  // A per-process fallback is not a security boundary on serverless: a new
  // instance starts with an empty counter. Fail closed until the distributed
  // database guard is available again.
  if (error?.code === "PGRST202" || error?.code === "42883") {
    Sentry.captureMessage("register_admin_login_attempt RPC unavailable — admin login denied fail-closed", {
      level: "error",
      tags: { subsystem: "admin-auth", fallback: "fail-closed" },
      extra: { postgrestCode: error.code, message: error.message },
    });
    throw new AdminLoginProtectionUnavailableError();
  }
  if (error) throw new Error("Не удалось проверить ограничение входа.");
  return typeof data === "number" ? data : 0;
}
