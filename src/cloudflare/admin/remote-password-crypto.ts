import { requestAdminJson } from "./json-request";

export interface RemoteAdminCryptoBindings {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  ADMIN_CRYPTO_KEY: string;
}

export class RemoteAdminCryptoError extends Error {
  constructor() {
    super("Admin password computation unavailable");
    this.name = "RemoteAdminCryptoError";
  }
}

function validAscii(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !/[^!-~]/.test(value);
}

function validEncodedHash(value: unknown): value is string {
  return typeof value === "string"
    && /^pbkdf2-sha256:600000:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{43}$/.test(value);
}

export function createRemoteAdminPasswordCrypto(
  bindings: RemoteAdminCryptoBindings,
  fetcher: typeof fetch = fetch,
): {
  verifyHash(password: string, encodedHash: string): Promise<boolean>;
  hashPassword(password: string): Promise<string>;
} {
  let url: URL;
  try {
    url = new URL(bindings.SUPABASE_URL);
    const localHttp = url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (!(url.protocol === "https:" || localHttp) || url.username || url.password || url.search || url.hash
      || !validAscii(bindings.SUPABASE_PUBLISHABLE_KEY)
      || !validAscii(bindings.ADMIN_CRYPTO_KEY) || bindings.ADMIN_CRYPTO_KEY.length < 32) throw new Error();
    url.pathname = "/functions/v1/admin-password-crypto";
  } catch {
    throw new RemoteAdminCryptoError();
  }

  const headers = new Headers({
    apikey: bindings.SUPABASE_PUBLISHABLE_KEY,
    "x-ayprom-admin-crypto-key": bindings.ADMIN_CRYPTO_KEY,
    "content-type": "application/json",
  });

  async function call(body: Record<string, string>): Promise<Record<string, unknown>> {
    try {
      const result = await requestAdminJson(new URL(url), { method: "POST", headers, body: JSON.stringify(body) }, fetcher);
      if (result.status !== 200 || result.payload === null || typeof result.payload !== "object" || Array.isArray(result.payload)) {
        throw new Error();
      }
      return result.payload as Record<string, unknown>;
    } catch {
      throw new RemoteAdminCryptoError();
    }
  }

  return {
    async verifyHash(password, encodedHash) {
      if (typeof password !== "string" || typeof encodedHash !== "string") throw new RemoteAdminCryptoError();
      const result = await call({ operation: "verify", password, encodedHash });
      if (Object.keys(result).length !== 1 || typeof result.valid !== "boolean") throw new RemoteAdminCryptoError();
      return result.valid;
    },
    async hashPassword(password) {
      if (typeof password !== "string") throw new RemoteAdminCryptoError();
      const result = await call({ operation: "hash", password });
      if (Object.keys(result).length !== 1 || !validEncodedHash(result.hash)) {
        throw new RemoteAdminCryptoError();
      }
      return result.hash;
    },
  };
}
