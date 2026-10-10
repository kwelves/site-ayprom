// Read-only reader of the current admin credential row for the thin Worker,
// shaped for createLegacyPasswordVerifier's `readCredentialState` and used by
// the local thin Worker composition. Production Next reads remain unchanged.
//
// Deliberately stricter than the historical Next adapter
// (src/lib/admin/credentials.ts), which treats a missing table as an empty row:
// only a successful 200 with `[]` means "no row" ({ passwordHash: null,
// sessionVersion: 1 }). A missing table (PGRST205/42P01/404), auth or
// permission errors, outages and malformed responses all reject — never a
// fallback to the env password.
//
// One GET per call, no cache, no retries, no writes or RPC. Transport limits
// (10 s deadline including body, 64 KiB, manual redirects rejected) come from
// requestAdminJson. The private key travels only in headers. Errors carry a
// fixed code and message, never a cause, payload, key or hash. Malformed but
// non-empty hashes are passed through: parsing them is the verifier's job.
import type { LegacyCredentialState } from "./legacy-password-verifier";
import { requestAdminJson } from "./json-request";

export interface AdminCredentialReaderBindings {
  SUPABASE_URL: string;
  ADMIN_SUPABASE_KEY: string;
}

export type AdminCredentialReaderErrorCode =
  | "configuration_invalid"
  | "backend_unavailable"
  | "response_invalid";

export class AdminCredentialReaderError extends Error {
  readonly code: AdminCredentialReaderErrorCode;

  constructor(code: AdminCredentialReaderErrorCode) {
    super("Admin credential state unavailable");
    this.name = "AdminCredentialReaderError";
    this.code = code;
  }
}

const EMPTY_TABLE_STATE_VERSION = 1;
// supabase/migrations/20260821171707_admin_credentials.sql:
// check (session_version >= 2). The empty-table version 1 never comes from a row.
const MIN_ROW_SESSION_VERSION = 2;

interface ReaderConfig {
  url: URL;
  key: string;
}

function parseConfig(bindings: AdminCredentialReaderBindings): ReaderConfig | null {
  const rawUrl = typeof bindings?.SUPABASE_URL === "string" ? bindings.SUPABASE_URL.trim() : "";
  const key = typeof bindings?.ADMIN_SUPABASE_KEY === "string" ? bindings.ADMIN_SUPABASE_KEY.trim() : "";
  // Supabase keys use printable ASCII. Reject other characters before Headers
  // can throw a platform-specific ByteString error (or accept C1 controls).
  if (!rawUrl || !key || /[^\u0021-\u007e]/.test(key)) return null;

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
  url.searchParams.set("select", "password_hash,session_version");
  url.searchParams.set("credential_key", "eq.primary");
  url.searchParams.set("limit", "2");
  return { url, key };
}

function parseState(payload: unknown): LegacyCredentialState | null {
  if (!Array.isArray(payload) || payload.length > 1) return null;
  if (payload.length === 0) return { passwordHash: null, sessionVersion: EMPTY_TABLE_STATE_VERSION };

  const row: unknown = payload[0];
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
  const { password_hash: passwordHash, session_version: sessionVersion } = row as Record<string, unknown>;
  if (typeof passwordHash !== "string" || passwordHash.length === 0) return null;
  if (!Number.isSafeInteger(sessionVersion) || (sessionVersion as number) < MIN_ROW_SESSION_VERSION) return null;
  return { passwordHash, sessionVersion: sessionVersion as number };
}

export function createAdminCredentialReader(
  bindings: AdminCredentialReaderBindings,
  fetcher: typeof fetch = fetch,
): () => Promise<LegacyCredentialState> {
  const config = parseConfig(bindings);

  return async () => {
    if (!config) throw new AdminCredentialReaderError("configuration_invalid");

    const headers = new Headers({ apikey: config.key, accept: "application/json" });
    // Same pattern as supabase-ports: new non-JWT keys go only as apikey,
    // legacy local JWT keys also need Bearer.
    if (config.key.startsWith("eyJ")) headers.set("authorization", `Bearer ${config.key}`);

    let result: Awaited<ReturnType<typeof requestAdminJson>>;
    try {
      result = await requestAdminJson(new URL(config.url), { method: "GET", headers }, fetcher);
    } catch {
      throw new AdminCredentialReaderError("backend_unavailable");
    }
    if (result.status !== 200) throw new AdminCredentialReaderError("response_invalid");

    const state = parseState(result.payload);
    if (!state) throw new AdminCredentialReaderError("response_invalid");
    return state;
  };
}
