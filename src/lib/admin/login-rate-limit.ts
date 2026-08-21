import "server-only";

import { headers } from "next/headers";
import * as Sentry from "@sentry/nextjs";
import { requireServerEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

const FALLBACK_WINDOW_MS = 15 * 60 * 1000;
const FALLBACK_MAX_ATTEMPTS = 5;

interface FallbackAttempt {
  count: number;
  windowStartedAt: number;
  blockedUntil: number;
}

const globalRateLimit = globalThis as typeof globalThis & {
  __aypromLoginRateLimit?: Map<string, FallbackAttempt>;
};

const fallbackAttempts = globalRateLimit.__aypromLoginRateLimit ?? new Map<string, FallbackAttempt>();
globalRateLimit.__aypromLoginRateLimit = fallbackAttempts;

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

function registerFallbackAttempt(keyHash: string, passwordIsValid: boolean): number {
  const now = Date.now();
  const current = fallbackAttempts.get(keyHash);

  if (current?.blockedUntil && current.blockedUntil > now) {
    return Math.ceil((current.blockedUntil - now) / 1000);
  }
  if (passwordIsValid) {
    fallbackAttempts.delete(keyHash);
    return 0;
  }

  const withinWindow = current && current.windowStartedAt > now - FALLBACK_WINDOW_MS;
  const count = withinWindow ? current.count + 1 : 1;
  const windowStartedAt = withinWindow ? current.windowStartedAt : now;
  const blockedUntil = count >= FALLBACK_MAX_ATTEMPTS ? now + FALLBACK_WINDOW_MS : 0;
  fallbackAttempts.set(keyHash, { count, windowStartedAt, blockedUntil });
  return blockedUntil ? Math.ceil((blockedUntil - now) / 1000) : 0;
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
  });

  // 42883 is deliberately broad: it covers both "function does not exist" and
  // "operator does not exist". That breadth is what let a real bug hide here
  // for months — the RPC existed but raised 42883 on every call because a
  // variable was named `current_time`, a reserved keyword, so every comparison
  // failed on a type mismatch. The caller read that as "not deployed yet" and
  // quietly degraded, meaning brute-force protection never actually ran.
  //
  // The in-memory fallback is per-process, so on serverless it is close to no
  // protection at all: each instance counts attempts separately. It is a
  // stopgap for the minutes between a deploy and its migration, never a
  // steady state — hence the alert.
  if (error?.code === "PGRST202" || error?.code === "42883") {
    Sentry.captureMessage("register_admin_login_attempt RPC unavailable — admin login rate limit degraded to in-memory", {
      level: "error",
      tags: { subsystem: "admin-auth", fallback: "in-memory-rate-limit" },
      extra: { postgrestCode: error.code, message: error.message },
    });
    return registerFallbackAttempt(keyHash, passwordIsValid);
  }
  if (error) throw new Error("Не удалось проверить ограничение входа.");
  return typeof data === "number" ? data : 0;
}
