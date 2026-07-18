// Signs/verifies the admin session cookie with HMAC-SHA256 via Web Crypto —
// deliberately not Node's `crypto` module, since this code runs both in
// Server Actions (Node runtime) and in middleware (Edge runtime), and Web
// Crypto is the one API both support.

export const SESSION_COOKIE_NAME = "admin_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24; // 1 day

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
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("ADMIN_SESSION_SECRET is not set");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function createSessionToken(): Promise<string> {
  const payload = JSON.stringify({ exp: Date.now() + SESSION_DURATION_SECONDS * 1000 });
  const payloadB64 = bufferToBase64Url(new TextEncoder().encode(payload).buffer);
  const key = await getHmacKey();
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${bufferToBase64Url(signature)}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [payloadB64, signatureB64] = token.split(".");
  if (!payloadB64 || !signatureB64) return false;

  try {
    const key = await getHmacKey();
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBuffer(signatureB64),
      new TextEncoder().encode(payloadB64)
    );
    if (!valid) return false;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBuffer(payloadB64))) as { exp: number };
    return payload.exp > Date.now();
  } catch {
    return false;
  }
}
