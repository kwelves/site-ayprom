import {
  createSessionCodec,
  SESSION_DURATION_SECONDS,
  SESSION_REFRESH_THRESHOLD_SECONDS,
} from "@/lib/admin/session-codec";
import { createRequestContext, runWithRequestContext } from "./request-context";
import { serializeSetCookie } from "./shims/next-headers";
import { isNotFoundError, readRedirectTarget } from "./shims/next-navigation";

const SESSION_COOKIE = "admin_session";
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_CREDENTIAL_CACHE_MS = 15_000;
const CLEARED_SESSION_COOKIE = `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
const FAILURE_MESSAGE = "Не удалось выполнить действие. Попробуйте ещё раз.";

export type AdminRpcAction = (...args: never[]) => Promise<unknown>;

export interface AdminRpcDeps {
  registry: Record<string, AdminRpcAction>;
  secret: string;
  now: () => number;
  /** Current admin password version from the database; a session with another version is dead. */
  credentialVersion: () => Promise<number>;
  credentialCacheMs?: number;
  /** Actions that run without a session (only the login form). */
  publicActions?: string[];
  /** Per-action body size limits in bytes (file uploads); everything else gets 1 MB. */
  bodyLimits?: Record<string, number>;
}

class BadRpcRequest extends Error {}

// Per isolate: asking the database on every click would add ~100 ms; a password change
// is therefore noticed within `credentialCacheMs` instead of instantly.
const credentialCache = new WeakMap<object, { version: number; at: number }>();

function json(status: number, body: unknown, extra: string[] = []): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  for (const cookie of extra) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function refuse(status: number, code: string, extra: string[] = [], allow?: string, reason?: string): Response {
  const response = json(status, { ok: false, error: reason ? { code, reason } : { code } }, extra);
  if (allow) response.headers.set("allow", allow);
  return response;
}

async function readBody(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
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
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Browsers send FormData and `undefined` as tagged objects; everything else is plain JSON.
function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (!isPlainObject(value)) return value;
  const keys = Object.keys(value);
  if ("$formData" in value) {
    const entries = value.$formData;
    if (keys.length !== 1 || !Array.isArray(entries)) throw new BadRpcRequest();
    const form = new FormData();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") throw new BadRpcRequest();
      form.append(entry[0], typeof entry[1] === "string" ? entry[1] : decodeFile(entry[1]));
    }
    return form;
  }
  if ("$undefined" in value) {
    if (keys.length !== 1 || value.$undefined !== true) throw new BadRpcRequest();
    return undefined;
  }
  return Object.fromEntries(keys.map((key) => [key, decodeValue(value[key])]));
}

// Strict base64 without a regular expression (a pattern over a 5 MB string overflows the regex stack):
// decode natively, then encode again; only canonical input survives the round trip, so whitespace,
// foreign characters and wrong padding are all refused.
function decodeBase64(value: string): Uint8Array | null {
  if (value.length % 4 !== 0) return null;
  const buffer = Buffer.from(value, "base64");
  return buffer.toString("base64") === value ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length) : null;
}

// An uploaded file travels inside the JSON as base64 and is rebuilt into a real File here.
function decodeFile(value: unknown): File {
  const tagged = isPlainObject(value) && Object.keys(value).length === 1 ? value.$file : undefined;
  if (!isPlainObject(tagged)) throw new BadRpcRequest();
  const { name, type, base64 } = tagged;
  if (typeof name !== "string" || typeof type !== "string" || typeof base64 !== "string") throw new BadRpcRequest();
  const bytes = decodeBase64(base64);
  if (!bytes) throw new BadRpcRequest();
  return new File([bytes as BlobPart], name, { type });
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.name;
  // Database client errors are plain objects with a short code such as "42501" or "PGRST205".
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(code) ? `object(code ${code})` : typeof error;
}

function isSafeRedirect(target: string): boolean {
  return target.startsWith("/") && !target.startsWith("//") && !target.includes("\\");
}

async function currentCredentialVersion(deps: AdminRpcDeps): Promise<number> {
  const key = deps.credentialVersion;
  const now = deps.now();
  const hit = credentialCache.get(key);
  if (hit && now - hit.at < (deps.credentialCacheMs ?? DEFAULT_CREDENTIAL_CACHE_MS)) return hit.version;
  const version = await deps.credentialVersion();
  credentialCache.set(key, { version, at: now });
  return version;
}

export async function handleAdminRpc(request: Request, name: string, deps: AdminRpcDeps): Promise<Response> {
  if (request.method !== "POST") return refuse(405, "method_not_allowed", [], "POST");

  // Same-origin only: a page on another site must not be able to drive the admin.
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return refuse(403, "forbidden_origin");
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) {
    return refuse(415, "unsupported_media_type");
  }

  const context = createRequestContext(request);
  const codec = createSessionCodec(deps.secret, deps.now);
  if (!deps.publicActions?.includes(name)) {
    const session = await codec.read(context.cookies.get(SESSION_COOKIE));
    if (!session) return refuse(401, "unauthorized");
    let version: number;
    try {
      version = await currentCredentialVersion(deps);
    } catch {
      return refuse(401, "unauthorized", [CLEARED_SESSION_COOKIE], undefined, "unavailable");
    }
    if (session.credentialVersion !== version) {
      return refuse(401, "unauthorized", [CLEARED_SESSION_COOKIE], undefined, "expired");
    }
    // Same sliding renewal the Next middleware did: a session close to its end is extended.
    if (Math.floor((session.exp - deps.now()) / 1000) < SESSION_REFRESH_THRESHOLD_SECONDS) {
      const token = await codec.create({ originalIssuedAt: session.iat, credentialVersion: session.credentialVersion });
      context.setCookies.push(serializeSetCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: new URL(request.url).protocol === "https:",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_DURATION_SECONDS,
      }));
    }
  }

  if (!Object.hasOwn(deps.registry, name)) return refuse(404, "unknown_action");

  let args: unknown[];
  try {
    const text = await readBody(request, deps.bodyLimits?.[name] ?? MAX_BODY_BYTES);
    if (text === null) return refuse(413, "payload_too_large");
    const parsed: unknown = JSON.parse(text);
    const rawArgs = isPlainObject(parsed) ? (parsed.args ?? []) : null;
    if (!Array.isArray(rawArgs)) return refuse(400, "bad_request");
    args = rawArgs.map(decodeValue);
  } catch {
    return refuse(400, "bad_request");
  }

  try {
    const value = await runWithRequestContext(context, () => (deps.registry[name] as (...input: unknown[]) => Promise<unknown>)(...args));
    return json(200, { ok: true, value }, context.setCookies);
  } catch (error) {
    const target = readRedirectTarget(error);
    if (target !== null && isSafeRedirect(target)) return json(200, { ok: true, redirect: target }, context.setCookies);
    if (isNotFoundError(error)) return json(404, { ok: false, notFound: true });
    // Only the action name, error class and a short machine code are logged: messages may carry secrets or personal data.
    console.error(`[admin-rpc] action_failed name=${name} error=${describeError(error)}`);
    return json(500, { ok: false, error: { code: "action_failed", message: FAILURE_MESSAGE } });
  }
}
