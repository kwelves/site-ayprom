import type { AdminAuthPorts, AuthAttemptReservation } from "./contracts";
import { requestAdminJson } from "./json-request";

export interface AdminBindings {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  ADMIN_SUPABASE_KEY: string;
  ADMIN_AUTH_EMAIL: string;
  ADMIN_AUTH_USER_ID: string;
}

type PrivatePorts = Pick<AdminAuthPorts, "reserve" | "finish" | "verifyPassword" | "credentialVersion">;

function unavailable(): Error {
  return new Error("Admin protection unavailable");
}

function verifierUnavailable(): Error {
  return new Error("Admin verifier unavailable");
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function endpoint(base: string, pathname: string): URL {
  const url = new URL(base);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) throw unavailable();
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url;
}

export interface AdminAttemptBindings {
  SUPABASE_URL: string;
  ADMIN_SUPABASE_KEY: string;
}

// Header construction throws a raw TypeError for a key with characters that are
// not valid in a header value; answer with the same fixed error as every other
// unusable binding instead, and never echo the key.
function createPrivateHeaders(privateKey: string): Headers {
  try {
    const headers = new Headers({ apikey: privateKey, "content-type": "application/json" });
    // New non-JWT keys are sent only as apikey; legacy local JWT keys need Bearer.
    if (privateKey.startsWith("eyJ")) headers.set("authorization", `Bearer ${privateKey}`);
    return headers;
  } catch {
    throw unavailable();
  }
}

/**
 * Login-attempt reservation and completion (atomic private RPCs) that need only
 * the Supabase URL and the server-side key: no Auth identity, no publishable key.
 */
export function createAdminAttemptPorts(
  bindings: AdminAttemptBindings,
  fetcher: typeof fetch = fetch,
): Pick<AdminAuthPorts, "reserve" | "finish"> {
  const privateKey = bindings?.ADMIN_SUPABASE_KEY?.trim();
  if (!privateKey || !bindings.SUPABASE_URL?.trim()) throw unavailable();
  const privateHeaders = createPrivateHeaders(privateKey);

  async function privateRequest(pathname: string, init: RequestInit): Promise<unknown> {
    try {
      const result = await requestAdminJson(endpoint(bindings.SUPABASE_URL, pathname), {
        ...init, headers: privateHeaders,
      }, fetcher);
      return result.payload;
    } catch {
      throw unavailable();
    }
  }

  return {
    async reserve(keyHash: string, scope: "login" | "password-change" = "login"): Promise<AuthAttemptReservation> {
      const payload = await privateRequest("/rest/v1/rpc/begin_admin_auth_attempt", {
        method: "POST",
        body: JSON.stringify({
          p_key_hash: keyHash,
          p_scope: scope,
          p_ttl_seconds: 30,
          p_max_concurrent: 3,
        }),
      });
      const row = Array.isArray(payload) && payload.length === 1 ? record(payload[0]) : null;
      if (!row || typeof row.out_allowed !== "boolean" || !Number.isSafeInteger(row.out_retry_after)
        || (row.out_retry_after as number) < 0 || (row.out_reservation_id !== null && typeof row.out_reservation_id !== "string")
        || (row.out_allowed && !row.out_reservation_id)) throw unavailable();
      return {
        allowed: row.out_allowed,
        retryAfter: row.out_retry_after as number,
        reservationId: row.out_reservation_id as string | null,
      };
    },

    async finish(reservationId: string, passwordIsValid: boolean): Promise<number> {
      const payload = await privateRequest("/rest/v1/rpc/finish_admin_auth_attempt", {
        method: "POST",
        body: JSON.stringify({ p_reservation_id: reservationId, p_password_is_valid: passwordIsValid }),
      });
      if (!Number.isSafeInteger(payload) || (payload as number) < 0) throw unavailable();
      return payload as number;
    },
  };
}

export function createSupabaseAdminPorts(
  bindings: AdminBindings,
  fetcher: typeof fetch = fetch,
): PrivatePorts {
  const publicKey = bindings.SUPABASE_PUBLISHABLE_KEY?.trim();
  const privateKey = bindings.ADMIN_SUPABASE_KEY?.trim();
  const email = bindings.ADMIN_AUTH_EMAIL?.trim();
  const userId = bindings.ADMIN_AUTH_USER_ID?.trim();
  if (!publicKey || !privateKey || !email || !userId || !bindings.SUPABASE_URL?.trim()) {
    throw unavailable();
  }
  const privateHeaders = createPrivateHeaders(privateKey);
  const { reserve, finish } = createAdminAttemptPorts(bindings, fetcher);

  return {
    reserve,
    finish,

    async verifyPassword(password: string): Promise<boolean> {
      let result: Awaited<ReturnType<typeof requestAdminJson>>;
      try {
        const authUrl = endpoint(bindings.SUPABASE_URL, "/auth/v1/token");
        authUrl.searchParams.set("grant_type", "password");
        result = await requestAdminJson(authUrl, {
          method: "POST",
          headers: { apikey: publicKey, "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        }, fetcher, { acceptedStatuses: [400] });
      } catch {
        throw verifierUnavailable();
      }
      const payload = result.payload;
      if (!result.ok) {
        const error = record(payload);
        if (result.status === 400 && (error?.code === "invalid_credentials" || error?.error_code === "invalid_credentials")) {
          return false;
        }
        throw verifierUnavailable();
      }
      const session = record(payload);
      const user = record(session?.user);
      if (!session || !user || typeof user.id !== "string"
        || typeof session.access_token !== "string" || typeof session.refresh_token !== "string") {
        throw verifierUnavailable();
      }
      return user.id === userId;
    },

    async credentialVersion(): Promise<number> {
      const url = endpoint(bindings.SUPABASE_URL, "/rest/v1/admin_credentials");
      url.searchParams.set("select", "session_version");
      url.searchParams.set("credential_key", "eq.primary");
      url.searchParams.set("limit", "2");
      let payload: unknown;
      try {
        const result = await requestAdminJson(url, { method: "GET", headers: privateHeaders }, fetcher);
        payload = result.payload;
      } catch {
        throw unavailable();
      }
      if (!Array.isArray(payload) || payload.length > 1) throw unavailable();
      if (payload.length === 0) return 1;
      const version = record(payload[0])?.session_version;
      if (!Number.isSafeInteger(version) || (version as number) < 1) throw unavailable();
      return version as number;
    },
  };
}
