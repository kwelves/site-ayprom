// Shared by the legacy Next adapter and the thin Worker. Keep this module
// independent of Node, Next, environment variables, and platform cookies.
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;
export const SESSION_REFRESH_THRESHOLD_SECONDS = 60 * 60;
const SESSION_ABSOLUTE_DURATION_SECONDS = 60 * 60 * 24 * 30;

export interface SessionPayload {
  iat: number;
  exp: number;
  credentialVersion: number;
}

export interface CreateSessionTokenOptions {
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

export function createSessionCodec(secret: string, now: () => number) {
  async function getHmacKey(): Promise<CryptoKey> {
    return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]);
  }

  return {
    async create({
      originalIssuedAt = now(),
      credentialVersion = 1,
    }: CreateSessionTokenOptions = {}): Promise<string> {
      const currentTime = now();
      const absoluteExpiration = originalIssuedAt + SESSION_ABSOLUTE_DURATION_SECONDS * 1000;
      const payload = JSON.stringify({
        iat: originalIssuedAt,
        exp: Math.min(currentTime + SESSION_DURATION_SECONDS * 1000, absoluteExpiration),
        credentialVersion,
      });
      const payloadB64 = bufferToBase64Url(new TextEncoder().encode(payload).buffer);
      const key = await getHmacKey();
      const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
      return `${payloadB64}.${bufferToBase64Url(signature)}`;
    },

    async read(token: string | undefined): Promise<SessionPayload | null> {
      if (!token) return null;
      const [payloadB64, signatureB64] = token.split(".");
      if (!payloadB64 || !signatureB64) return null;

      try {
        const key = await getHmacKey();
        const valid = await crypto.subtle.verify(
          "HMAC",
          key,
          base64UrlToBuffer(signatureB64),
          new TextEncoder().encode(payloadB64),
        );
        if (!valid) return null;

        const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBuffer(payloadB64))) as Partial<SessionPayload>;
        const currentTime = now();
        // Tokens issued before credential versioning remain version one.
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
        const withinAbsoluteLifetime = currentTime - payload.iat <= SESSION_ABSOLUTE_DURATION_SECONDS * 1000;
        return hasValidShape && payload.exp > currentTime && withinAbsoluteLifetime ? payload : null;
      } catch {
        return null;
      }
    },
  };
}
