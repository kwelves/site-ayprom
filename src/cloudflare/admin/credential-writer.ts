// Internal, unwired compare-and-set writer of the admin credential row for the
// thin Worker. It is NOT a password-change API: authentication, the current
// password, Origin/CSRF and creation of the hash belong to whoever calls it, and
// it is not connected to the handler or worker.ts.
//
// Same table and rules as the historical Next adapter (replaceAdminPasswordHash
// in src/lib/admin/credentials.ts), over PostgREST with the server-side key:
// - expectedVersion 1 (empty table): INSERT `primary` with version 2; a duplicate
//   key (409 / 23505) means someone got there first → conflict;
// - expectedVersion >= 2: PATCH `primary` only where session_version equals
//   expectedVersion; no updated row → conflict;
// - success is confirmed by the returned row carrying the expected next version.
// Everything else — outage, auth/permission errors, a missing table, redirects,
// oversized or malformed responses — is an error, never a conflict or a success.
//
// Reuses requestAdminJson (10 s deadline including the body, 64 KiB, manual
// redirects rejected, no retries). One request per call, no cache, no reads.
// The private key travels only in headers; errors carry a fixed code and message.
import { requestAdminJson } from "./json-request";

export interface AdminCredentialWriterBindings {
  SUPABASE_URL: string;
  ADMIN_SUPABASE_KEY: string;
}

export type AdminCredentialWriterErrorCode =
  | "configuration_invalid"
  | "input_invalid"
  | "conflict"
  | "backend_unavailable"
  | "response_invalid";

const MESSAGES: Record<AdminCredentialWriterErrorCode, string> = {
  configuration_invalid: "Admin credential update unavailable",
  input_invalid: "Admin credential update unavailable",
  conflict: "Admin credential changed concurrently",
  backend_unavailable: "Admin credential update unavailable",
  response_invalid: "Admin credential update unavailable",
};

export class AdminCredentialWriterError extends Error {
  readonly code: AdminCredentialWriterErrorCode;

  constructor(code: AdminCredentialWriterErrorCode) {
    super(MESSAGES[code]);
    this.name = "AdminCredentialWriterError";
    this.code = code;
  }
}

export interface AdminCredentialWriter {
  /** Resolves with the new session version; rejects with AdminCredentialWriterError. */
  replacePasswordHash(passwordHash: string, expectedVersion: number): Promise<number>;
}

// A PBKDF2 encoding is ~100 characters. The bound only keeps an absurd value
// from being sent; the format itself is the verifier's concern, not this writer's.
const MAX_PASSWORD_HASH_LENGTH = 1024;
const EMPTY_TABLE_VERSION = 1;
const POSTGRES_UNIQUE_VIOLATION = "23505";

interface WriterConfig {
  url: URL;
  key: string;
}

function parseConfig(bindings: AdminCredentialWriterBindings): WriterConfig | null {
  const rawUrl = typeof bindings?.SUPABASE_URL === "string" ? bindings.SUPABASE_URL.trim() : "";
  const key = typeof bindings?.ADMIN_SUPABASE_KEY === "string" ? bindings.ADMIN_SUPABASE_KEY.trim() : "";
  // Visible ASCII only: a header value must not carry control or non-ASCII characters.
  if (!rawUrl || !key || /[^!-~]/.test(key)) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
  url.pathname = "/rest/v1/admin_credentials";
  url.search = "";
  url.hash = "";
  return { url, key };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** True when the response is exactly one row whose session_version is `version`. */
function confirmsVersion(payload: unknown, version: number): boolean {
  return Array.isArray(payload) && payload.length === 1 && record(payload[0])?.session_version === version;
}

export function createAdminCredentialWriter(
  bindings: AdminCredentialWriterBindings,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): AdminCredentialWriter {
  const config = parseConfig(bindings);

  return {
    async replacePasswordHash(passwordHash, expectedVersion) {
      if (!config) throw new AdminCredentialWriterError("configuration_invalid");
      if (typeof passwordHash !== "string" || passwordHash.length === 0 || passwordHash.length > MAX_PASSWORD_HASH_LENGTH) {
        throw new AdminCredentialWriterError("input_invalid");
      }
      const nextVersion = typeof expectedVersion === "number" ? expectedVersion + 1 : Number.NaN;
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < EMPTY_TABLE_VERSION || !Number.isSafeInteger(nextVersion)) {
        throw new AdminCredentialWriterError("input_invalid");
      }

      const insert = expectedVersion === EMPTY_TABLE_VERSION;
      // `select` limits the returned representation to the one column we verify.
      const query = new URLSearchParams();
      if (!insert) {
        query.set("credential_key", "eq.primary");
        query.set("session_version", `eq.${expectedVersion}`);
      }
      query.set("select", "session_version");
      const url = new URL(config.url);
      url.search = query.toString();

      const headers = new Headers({
        apikey: config.key,
        accept: "application/json",
        "content-type": "application/json",
        prefer: "return=representation",
      });
      // New non-JWT keys go only as apikey; legacy local JWT keys also need Bearer.
      if (config.key.startsWith("eyJ")) headers.set("authorization", `Bearer ${config.key}`);

      let updatedAt: string;
      try {
        updatedAt = new Date(now()).toISOString();
      } catch {
        throw new AdminCredentialWriterError("backend_unavailable");
      }
      const values = {
        password_hash: passwordHash,
        session_version: nextVersion,
        updated_at: updatedAt,
      };
      const init: RequestInit = insert
        ? { method: "POST", headers, body: JSON.stringify({ credential_key: "primary", ...values }) }
        : { method: "PATCH", headers, body: JSON.stringify(values) };

      let result: Awaited<ReturnType<typeof requestAdminJson>>;
      try {
        // Only the insert path accepts a 409 body, to tell a duplicate key from other conflicts.
        result = await requestAdminJson(url, init, fetcher, { acceptedStatuses: insert ? [409] : [] });
      } catch {
        throw new AdminCredentialWriterError("backend_unavailable");
      }

      if (insert) {
        if (result.status === 409) {
          if (record(result.payload)?.code === POSTGRES_UNIQUE_VIOLATION) throw new AdminCredentialWriterError("conflict");
          throw new AdminCredentialWriterError("backend_unavailable");
        }
        if (result.status !== 201 || !confirmsVersion(result.payload, nextVersion)) {
          throw new AdminCredentialWriterError("response_invalid");
        }
        return nextVersion;
      }

      if (result.status !== 200) throw new AdminCredentialWriterError("response_invalid");
      if (Array.isArray(result.payload) && result.payload.length === 0) throw new AdminCredentialWriterError("conflict");
      if (!confirmsVersion(result.payload, nextVersion)) throw new AdminCredentialWriterError("response_invalid");
      return nextVersion;
    },
  };
}
