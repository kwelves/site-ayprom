// Signs/verifies the admin session cookie with HMAC-SHA256 via Web Crypto —
// deliberately not Node's `crypto` module, since this code runs both in
// Server Actions (Node runtime) and in middleware (Edge runtime), and Web
// Crypto is the one API both support.
//
// No `server-only` import here for that same reason: this module is pulled in
// by src/proxy.ts, and the guard is unnecessary anyway — nothing in it is
// reachable from a Client Component.

import { requireServerEnv } from "@/lib/env";

export const SESSION_COOKIE_NAME = "admin_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days
export const SESSION_REFRESH_THRESHOLD_SECONDS = 60 * 60; // refresh during the final hour
const SESSION_ABSOLUTE_DURATION_SECONDS = 60 * 60 * 24 * 30; // force a new login after 30 days

export interface SessionPayload {
  iat: number;
  exp: number;
  credentialVersion: number;
}

interface CreateSessionTokenOptions {
  originalIssuedAt?: number;
  credentialVersion?: number;
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBuffer(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getHmacKey(): Promise<CryptoKey> {
  const secret = requireServerEnv("ADMIN_SESSION_SECRET");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function createSessionToken({
  originalIssuedAt = Date.now(),
  credentialVersion = 1,
}: CreateSessionTokenOptions = {}): Promise<string> {
  const now = Date.now();
  const absoluteExpiration = originalIssuedAt + SESSION_ABSOLUTE_DURATION_SECONDS * 1000;
  const payload = JSON.stringify({
    iat: originalIssuedAt,
    exp: Math.min(now + SESSION_DURATION_SECONDS * 1000, absoluteExpiration),
    credentialVersion,
  });
  const payloadB64 = bufferToBase64Url(new TextEncoder().encode(payload).buffer);
  const key = await getHmacKey();
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${bufferToBase64Url(signature)}`;
}

export async function getSessionPayload(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  const [payloadB64, signatureB64] = token.split(".");
  if (!payloadB64 || !signatureB64) return null;

  try {
    const key = await getHmacKey();
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBuffer(signatureB64),
      new TextEncoder().encode(payloadB64)
    );
    if (!valid) return null;

    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBuffer(payloadB64))) as Partial<SessionPayload>;
    const now = Date.now();
    // Tokens created before credential versioning are version 1. This keeps
    // every current production session valid until a password is actually
    // changed, at which point the database version increments to 2.
    const payload: SessionPayload = {
      iat: parsed.iat ?? Number.NaN,
      exp: parsed.exp ?? Number.NaN,
      credentialVersion: parsed.credentialVersion ?? 1,
    };
    const hasValidShape =
      Number.isFinite(payload.iat) &&
      Number.isFinite(payload.exp) &&
      Number.isSafeInteger(payload.credentialVersion) &&
      payload.credentialVersion >= 1 &&
      payload.iat <= payload.exp;
    const withinAbsoluteLifetime = now - payload.iat <= SESSION_ABSOLUTE_DURATION_SECONDS * 1000;
    return hasValidShape && payload.exp > now && withinAbsoluteLifetime ? payload : null;
  } catch {
    return null;
  }
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  return (await getSessionPayload(token)) !== null;
}
