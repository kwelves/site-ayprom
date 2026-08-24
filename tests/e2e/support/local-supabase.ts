import { createClient } from "@supabase/supabase-js";

export function getLocalAdminClient() {
  if (process.env.E2E_LOCAL_RUNTIME_VERIFIED !== "1") {
    throw new Error("E2E database writes запрещены вне проверенного local runtime.");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) throw new Error("Не заданы local Supabase env для E2E fixtures.");

  const parsedUrl = new URL(url);
  if (
    parsedUrl.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(parsedUrl.hostname) ||
    parsedUrl.port !== "54321"
  ) {
    throw new Error("E2E database writes разрешены только в local Supabase на порту 54321.");
  }

  return createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
