const MAX_BODY_BYTES = 4 * 1024;
const MAX_PASSWORD_BYTES = 1024;
const FORM_CONTENT_TYPE = /^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i;
const SESSION_VALUE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

export async function readFormFields(request: Request, maxBytes = MAX_BODY_BYTES): Promise<URLSearchParams | null> {
  if (request.method !== "POST" || !FORM_CONTENT_TYPE.test(request.headers.get("content-type") ?? "")) {
    return null;
  }
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

export async function readLoginRequest(request: Request): Promise<{ password: string } | null> {
  const fields = await readFormFields(request);
  if (!fields) return null;
  if ([...fields.keys()].length !== 1 || !fields.has("password")) return null;
  const password = fields.get("password");
  if (!password || new TextEncoder().encode(password).byteLength > MAX_PASSWORD_BYTES) return null;
  return { password };
}

export async function readPasswordChangeRequest(request: Request): Promise<{
  currentPassword: string; newPassword: string; confirmPassword: string;
} | null> {
  const fields = await readFormFields(request);
  if (!fields || [...fields.keys()].length !== 3
    || !fields.has("currentPassword") || !fields.has("newPassword") || !fields.has("confirmPassword")) return null;
  const currentPassword = fields.get("currentPassword");
  const newPassword = fields.get("newPassword");
  const confirmPassword = fields.get("confirmPassword");
  if (!currentPassword || !newPassword || !confirmPassword
    || [currentPassword, newPassword, confirmPassword].some((value) => new TextEncoder().encode(value).byteLength > MAX_PASSWORD_BYTES)) return null;
  return { currentPassword, newPassword, confirmPassword };
}

export function readSessionCookie(header: string | null): string | null {
  if (!header) return null;
  let session: string | null = null;
  for (const cookie of header.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== "admin_session") continue;
    if (session !== null) return null;
    const value = cookie.slice(separator + 1).trim();
    if (!SESSION_VALUE.test(value)) return null;
    session = value;
  }
  return session;
}
