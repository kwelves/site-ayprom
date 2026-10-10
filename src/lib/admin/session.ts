// Legacy Next adapter: its public exports and cookie format remain unchanged.
import { requireServerEnv } from "@/lib/env";
import { createSessionCodec, type CreateSessionTokenOptions } from "@/lib/admin/session-codec";

export {
  SESSION_DURATION_SECONDS,
  SESSION_REFRESH_THRESHOLD_SECONDS,
  type SessionPayload,
} from "@/lib/admin/session-codec";

export const SESSION_COOKIE_NAME = "admin_session";

export async function createSessionToken(options: CreateSessionTokenOptions = {}): Promise<string> {
  return createSessionCodec(requireServerEnv("ADMIN_SESSION_SECRET"), Date.now).create(options);
}

export async function getSessionPayload(token: string | undefined) {
  if (!token) return null;
  try {
    return await createSessionCodec(requireServerEnv("ADMIN_SESSION_SECRET"), Date.now).read(token);
  } catch {
    // Preserve the legacy fail-closed result when the server secret is unavailable.
    return null;
  }
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  return (await getSessionPayload(token)) !== null;
}
