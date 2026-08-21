import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireServerEnv } from "@/lib/env";
import { constantTimePasswordEqual, verifyAdminPasswordHash } from "@/lib/admin/password-credential";

const PRIMARY_CREDENTIAL_KEY = "primary";
const INITIAL_CREDENTIAL_VERSION = 1;

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
  return (await getAdminCredentialState()).sessionVersion;
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
  return nextVersion;
}
