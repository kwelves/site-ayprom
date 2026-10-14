// Framework-neutral verifier for the *current* production admin password
// scheme: the `admin_credentials` row's PBKDF2 hash when present, otherwise the
// server-held ADMIN_PASSWORD. The local thin Worker composition passes these
// methods to createAdminHandler; the production Next adapter remains unchanged.
//
// Deliberately stricter than the legacy Next adapter (src/lib/admin/credentials.ts),
// which falls back to the env password for any falsy hash:
// - only an explicit `passwordHash: null` from the reader selects the env path;
//   "", undefined or a non-string is an invalid state, never a fallback;
// - reader failures, invalid state, an unusable env secret, and a PBKDF2
//   runtime failure all reject with a LegacyPasswordVerifierError (the handler
//   treats a rejection as fail-closed "security", distinct from a wrong password);
// - state is read on every call; nothing is cached.
// Errors carry only a code: no cause, backend text, password or hash.
import { constantTimePasswordEqual, verifyAdminPasswordHash } from "@/lib/admin/password-credential";
import type { AdminAuthPorts } from "./contracts";

export interface LegacyCredentialState {
  passwordHash: string | null;
  sessionVersion: number;
}

export interface LegacyPasswordVerifierOptions {
  /** Must report an empty credential row as `{ passwordHash: null, sessionVersion }`
   * and throw on any backend failure; this module does not guess either. */
  readCredentialState(): Promise<LegacyCredentialState>;
  /** Server-only ADMIN_PASSWORD binding. Read only when the row has no hash. */
  readEnvPassword(): string | undefined;
  /** Optional trusted Supabase function. No local PBKDF2 fallback on error. */
  verifyHash?(password: string, encodedHash: string): Promise<boolean>;
}

export type LegacyPasswordVerifierErrorCode =
  | "credential_state_unavailable"
  | "credential_state_invalid"
  | "env_password_unavailable"
  | "password_hash_verification_failed";

export class LegacyPasswordVerifierError extends Error {
  readonly code: LegacyPasswordVerifierErrorCode;

  constructor(code: LegacyPasswordVerifierErrorCode) {
    super(`Admin password verification unavailable: ${code}`);
    this.name = "LegacyPasswordVerifierError";
    this.code = code;
  }
}

// Mirrors SERVER_SECRET_RULES.ADMIN_PASSWORD in src/lib/env.ts, which is not
// exported and reads process.env. Kept in lockstep by a parity test against
// requireServerEnv("ADMIN_PASSWORD").
const ENV_PASSWORD_MIN_BYTES = 12;
const ENV_PASSWORD_DOCUMENTED_PLACEHOLDERS = ["replace-with-a-long-random-password"];
const GENERIC_PLACEHOLDER = /^(change-?me|replace-?me|example|placeholder)([-_].*)?$/;

function isCredentialState(value: unknown): value is LegacyCredentialState {
  if (typeof value !== "object" || value === null) return false;
  const { passwordHash, sessionVersion } = value as Record<string, unknown>;
  const validHash = passwordHash === null || (typeof passwordHash === "string" && passwordHash.length > 0);
  return validHash && Number.isSafeInteger(sessionVersion) && (sessionVersion as number) >= 1;
}

function isUsableEnvPassword(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase();
  return (
    new TextEncoder().encode(value).byteLength >= ENV_PASSWORD_MIN_BYTES &&
    !ENV_PASSWORD_DOCUMENTED_PLACEHOLDERS.includes(normalized) &&
    !GENERIC_PLACEHOLDER.test(normalized)
  );
}

export function createLegacyPasswordVerifier(
  options: LegacyPasswordVerifierOptions,
): Pick<AdminAuthPorts, "verifyPassword" | "credentialVersion"> &
  Required<Pick<AdminAuthPorts, "verifyPasswordWithVersion">> {
  async function readState(): Promise<LegacyCredentialState> {
    let state: unknown;
    try {
      state = await options.readCredentialState();
    } catch {
      throw new LegacyPasswordVerifierError("credential_state_unavailable");
    }
    if (!isCredentialState(state)) throw new LegacyPasswordVerifierError("credential_state_invalid");
    // A port may return a shared mutable object. Capture both primitive fields
    // before crypto yields; a later mutation must not relabel an old password
    // check with the new credential version.
    return { passwordHash: state.passwordHash, sessionVersion: state.sessionVersion };
  }

  function readEnvPassword(): string {
    let value: unknown;
    try {
      value = options.readEnvPassword();
    } catch {
      throw new LegacyPasswordVerifierError("env_password_unavailable");
    }
    if (!isUsableEnvPassword(value)) throw new LegacyPasswordVerifierError("env_password_unavailable");
    return value;
  }

  async function checkAgainst(state: LegacyCredentialState, password: string): Promise<boolean> {
    if (state.passwordHash !== null) {
      try {
        return await (options.verifyHash ?? verifyAdminPasswordHash)(password, state.passwordHash);
      } catch {
        throw new LegacyPasswordVerifierError("password_hash_verification_failed");
      }
    }
    return constantTimePasswordEqual(password, readEnvPassword());
  }

  return {
    async verifyPassword(password) {
      return checkAgainst(await readState(), password);
    },

    // One state read, one password check: the version returned belongs to the
    // very state the password was checked against, so a password change between
    // "check" and "issue session" cannot pair an old password with a newer version.
    async verifyPasswordWithVersion(password) {
      const state = await readState();
      return (await checkAgainst(state, password))
        ? { valid: true, credentialVersion: state.sessionVersion }
        : { valid: false };
    },

    async credentialVersion() {
      return (await readState()).sessionVersion;
    },
  };
}
