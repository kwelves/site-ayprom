import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireServerEnv } from "@/lib/env";
import { constantTimePasswordEqual, verifyAdminPasswordHash } from "@/lib/admin/password-credential";

const PRIMARY_CREDENTIAL_KEY = "primary";
const INITIAL_CREDENTIAL_VERSION = 1;
// Proxy runs for navigations and Next.js prefetches. Hitting Supabase for the
// same credential version on every one of those requests adds a full network
// round trip before the page can even start rendering. Keep the fail-closed
// database check, but share its result briefly inside each warm server
// instance. Password changes invalidate the local entry immediately; other
// instances can retain the old version for at most this small window.
const CREDENTIAL_VERSION_CACHE_MS = 10_000;

let cachedCredentialVersion: { value: number; expiresAt: number } | null = null;
let credentialVersionRequest: Promise<number> | null = null;

interface AdminCredentialRow {
  password_hash: string;
  session_version: number;
}

export interface AdminCredentialState {
  passwordHash: string | null;
  sessionVersion: number;
}

export class AdminCredentialConflictError extends Error {
  constructor() {
    super("Admin credential changed concurrently");
    this.name = "AdminCredentialConflictError";
  }
}

function isCredentialsTableUnavailable(error: { code?: string } | null): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

export async function getAdminCredentialState(): Promise<AdminCredentialState> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("admin_credentials")
    .select("password_hash, session_version")
    .eq("credential_key", PRIMARY_CREDENTIAL_KEY)
    .maybeSingle();

  // Allows a migration-first rollout and keeps the existing environment
  // password working until the new table is present. All other database
  // failures fail closed instead of silently falling back to the old secret.
  if (isCredentialsTableUnavailable(error)) {
    return { passwordHash: null, sessionVersion: INITIAL_CREDENTIAL_VERSION };
  }
  if (error) throw new Error("Не удалось проверить учётные данные администратора.");

  const row = data as AdminCredentialRow | null;
  return row
    ? { passwordHash: row.password_hash, sessionVersion: row.session_version }
    : { passwordHash: null, sessionVersion: INITIAL_CREDENTIAL_VERSION };
}

export async function verifyAdminPassword(
  password: string,
  state: AdminCredentialState,
): Promise<boolean> {
  if (state.passwordHash) return verifyAdminPasswordHash(password, state.passwordHash);
  return constantTimePasswordEqual(password, requireServerEnv("ADMIN_PASSWORD"));
}

export async function getAdminCredentialVersion(): Promise<number> {
  const now = Date.now();
  if (cachedCredentialVersion && cachedCredentialVersion.expiresAt > now) {
    return cachedCredentialVersion.value;
  }

  if (!credentialVersionRequest) {
    credentialVersionRequest = getAdminCredentialState()
      .then((state) => {
        cachedCredentialVersion = {
          value: state.sessionVersion,
          expiresAt: Date.now() + CREDENTIAL_VERSION_CACHE_MS,
        };
        return state.sessionVersion;
      })
      .finally(() => {
        credentialVersionRequest = null;
      });
  }

  return credentialVersionRequest;
}

export function invalidateAdminCredentialVersionCache(): void {
  cachedCredentialVersion = null;
}

export async function replaceAdminPasswordHash(
  passwordHash: string,
  expectedVersion: number,
): Promise<number> {
  const supabase = createAdminClient();
  const nextVersion = expectedVersion + 1;
  const values = {
    credential_key: PRIMARY_CREDENTIAL_KEY,
    password_hash: passwordHash,
    session_version: nextVersion,
    updated_at: new Date().toISOString(),
  };

  if (expectedVersion === INITIAL_CREDENTIAL_VERSION) {
    const { error } = await supabase.from("admin_credentials").insert(values);
    if (error?.code === "23505") throw new AdminCredentialConflictError();
    if (error) throw new Error("Не удалось сохранить новый пароль.");
    invalidateAdminCredentialVersionCache();
    return nextVersion;
  }

  const { data, error } = await supabase
    .from("admin_credentials")
    .update(values)
    .eq("credential_key", PRIMARY_CREDENTIAL_KEY)
    .eq("session_version", expectedVersion)
    .select("session_version")
    .maybeSingle();
  if (error) throw new Error("Не удалось сохранить новый пароль.");
  if (!data) throw new AdminCredentialConflictError();
  invalidateAdminCredentialVersionCache();
  return nextVersion;
}
