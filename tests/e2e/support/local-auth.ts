import { createHash } from "node:crypto";
import { getLocalAdminClient } from "./local-supabase";

const PRIMARY_CREDENTIAL_KEY = "primary";

export function getLocalLoginAttemptKeyHashes(): string[] {
  if (process.env.E2E_LOCAL_RUNTIME_VERIFIED !== "1") {
    throw new Error("Вычисление E2E rate-limit key запрещено вне local runtime.");
  }
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("ADMIN_SESSION_SECRET не задан для local E2E.");
  return ["unknown", "127.0.0.1", "::ffff:127.0.0.1"].map((address) =>
    createHash("sha256").update(`${secret}:login:${address}`).digest("hex"),
  );
}

export async function cleanupLocalLoginAttempt(): Promise<void> {
  const supabase = getLocalAdminClient();
  const attemptKeyHashes = getLocalLoginAttemptKeyHashes();
  const { error: limitError } = await supabase
    .from("admin_login_rate_limits")
    .delete()
    .in("key_hash", attemptKeyHashes);
  if (limitError) throw limitError;

  const { error: eventError } = await supabase
    .from("admin_auth_events")
    .delete()
    .in("attempt_key_hash", attemptKeyHashes);
  if (eventError) throw eventError;
}

export async function assertLocalAdminCredentialAbsent(): Promise<void> {
  const supabase = getLocalAdminClient();
  const { data, error: lookupError } = await supabase
    .from("admin_credentials")
    .select("credential_key")
    .eq("credential_key", PRIMARY_CREDENTIAL_KEY)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (data) {
    throw new Error(
      "Admin E2E требует отдельный local Supabase без строки admin_credentials.primary. Existing credential не изменена; очистите только свой локальный test runtime и повторите запуск.",
    );
  }
}
