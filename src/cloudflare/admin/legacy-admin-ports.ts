// Composition of the ports the thin Worker uses to accept today's
// production admin password scheme (an `admin_credentials` PBKDF2 hash, else
// the server-held ADMIN_PASSWORD) with the shared login-attempt protection.
// Needs no Supabase Auth: no ADMIN_AUTH_EMAIL / ADMIN_AUTH_USER_ID, no
// publishable key, and it never calls the GoTrue token endpoint.
//
// Everything here is reuse: reserve/finish come from createAdminAttemptPorts,
// the credential row from createAdminCredentialReader, password + version
// proof from createLegacyPasswordVerifier. Transport limits (10 s, 64 KiB,
// manual redirects rejected, no retries) are requestAdminJson's. Wired only in
// the local preparation branch; this does not switch the production Next adapter.
import type { AdminAuthPorts } from "./contracts";
import { createAdminCredentialReader } from "./credential-reader";
import { createLegacyPasswordVerifier } from "./legacy-password-verifier";
import { createAdminAttemptPorts } from "./supabase-ports";
import { createRemoteAdminPasswordCrypto } from "./remote-password-crypto";
import { createAdminCredentialWriter } from "./credential-writer";

export interface LegacyAdminBindings {
  SUPABASE_URL: string;
  /** Server-side key. Sent only in request headers. */
  ADMIN_SUPABASE_KEY: string;
  /** Server-side secret. Used only while the credential row is empty. */
  ADMIN_PASSWORD?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  ADMIN_CRYPTO_KEY?: string;
}

export type LegacyAdminPorts =
  Pick<AdminAuthPorts, "reserve" | "finish" | "verifyPassword" | "credentialVersion"> &
  Required<Pick<AdminAuthPorts, "verifyPasswordWithVersion">> &
  Pick<AdminAuthPorts, "hashPassword" | "replacePasswordHash">;

export function createLegacyAdminPorts(
  bindings: LegacyAdminBindings,
  fetcher: typeof fetch = fetch,
): LegacyAdminPorts {
  // Copy once: later changes to the caller's bindings object are not observed.
  const backend = { SUPABASE_URL: bindings?.SUPABASE_URL, ADMIN_SUPABASE_KEY: bindings?.ADMIN_SUPABASE_KEY };
  const envPassword = bindings?.ADMIN_PASSWORD;

  // The credential reader accepts only visible ASCII in the key, while the
  // attempt ports also tolerate inner whitespace (kept for the existing Auth
  // adapter). Refuse such a key here, before any I/O, so the composed ports
  // never half-work (reservation succeeding, then the row read failing).
  if (typeof backend.ADMIN_SUPABASE_KEY === "string" && /[^!-~]/.test(backend.ADMIN_SUPABASE_KEY.trim())) {
    throw new Error("Admin protection unavailable");
  }

  const attempts = createAdminAttemptPorts(backend, fetcher);
  const remoteCrypto = bindings.ADMIN_CRYPTO_KEY === undefined ? null : createRemoteAdminPasswordCrypto({
    SUPABASE_URL: backend.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: bindings.SUPABASE_PUBLISHABLE_KEY ?? "",
    ADMIN_CRYPTO_KEY: bindings.ADMIN_CRYPTO_KEY,
  }, fetcher);
  const verifier = createLegacyPasswordVerifier({
    readCredentialState: createAdminCredentialReader(backend, fetcher),
    readEnvPassword: () => envPassword,
    verifyHash: remoteCrypto?.verifyHash,
  });

  return {
    reserve: attempts.reserve,
    finish: attempts.finish,
    verifyPassword: verifier.verifyPassword,
    verifyPasswordWithVersion: verifier.verifyPasswordWithVersion,
    credentialVersion: verifier.credentialVersion,
    ...(remoteCrypto ? {
      hashPassword: remoteCrypto.hashPassword,
      replacePasswordHash: createAdminCredentialWriter(backend, fetcher).replacePasswordHash,
    } : {}),
  };
}
