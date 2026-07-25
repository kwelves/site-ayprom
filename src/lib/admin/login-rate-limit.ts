import "server-only";

import { headers } from "next/headers";
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

export async function constantTimePasswordEqual(provided: string, expected: string): Promise<boolean> {
  const [providedDigest, expectedDigest] = await Promise.all([sha256(provided), sha256(expected)]);
  let difference = 0;
  for (let index = 0; index < expectedDigest.length; index += 1) {
    difference |= providedDigest[index] ^ expectedDigest[index];
  }
  return difference === 0;
}

async function getAttemptKeyHash(): Promise<string> {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwardedFor || requestHeaders.get("x-real-ip") || "unknown";
  const secret = requireServerEnv("ADMIN_SESSION_SECRET");
  const digest = await sha256(`${secret}:${address}`);
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

export async function registerLoginAttempt(passwordIsValid: boolean): Promise<number> {
  const keyHash = await getAttemptKeyHash();
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("register_admin_login_attempt", {
    attempt_key_hash: keyHash,
    password_is_valid: passwordIsValid,
  });

  if (error?.code === "PGRST202" || error?.code === "42883") {
    return registerFallbackAttempt(keyHash, passwordIsValid);
  }
  if (error) throw new Error("Не удалось проверить ограничение входа.");
  return typeof data === "number" ? data : 0;
}
