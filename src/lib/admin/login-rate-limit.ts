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
