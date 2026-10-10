// Explicit catalog source for a future Workers Build. Diagnostic loopback
// stays separate: a remote public URL is accepted only in workers-build mode.
import path from "node:path";

export const LOOPBACK_FIXTURE_ORIGINS = [
  "http://127.0.0.1:54321",
  "http://localhost:54321",
  "http://127.0.0.1:56421",
] as const;

const INHERITED_ENV_KEYS = [
  "PATH", "Path", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT",
  "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LANG", "LC_ALL",
];

export type WorkersBuildMode = "loopback-fixture" | "workers-build";

export type WorkersBuildBindingCode =
  | "build_mode_required"
  | "binding_missing"
  | "binding_invalid"
  | "remote_requires_explicit_build_mode"
  | "https_required"
  | "host_not_allowlisted"
  | "allowlist_invalid"
  | "service_role_forbidden";

export interface WorkersBuildBindingInput {
  mode: string;
  supabaseUrl: string;
  publishableKey: string;
  allowlist?: readonly string[];
}

export type WorkersBuildBinding =
  | { ok: true; mode: WorkersBuildMode; url: string; key: string }
  | { ok: false; code: WorkersBuildBindingCode };

export function parseWorkersBuildAllowlist(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function resolveWorkersBuildBinding(input: WorkersBuildBindingInput): WorkersBuildBinding {
  if (input.mode !== "workers-build" && input.mode !== "loopback-fixture") {
    return { ok: false, code: "build_mode_required" };
  }
  if (!input.supabaseUrl || !input.publishableKey) return { ok: false, code: "binding_missing" };
  const kind = publicKeyKind(input.publishableKey);
  if (kind === "service") return { ok: false, code: "service_role_forbidden" };
  if (kind !== "publishable" && kind !== "anon") return { ok: false, code: "binding_invalid" };

  if (input.mode === "loopback-fixture") {
    if ((LOOPBACK_FIXTURE_ORIGINS as readonly string[]).includes(input.supabaseUrl)) {
      return { ok: true, mode: "loopback-fixture", url: input.supabaseUrl, key: input.publishableKey };
    }
    return {
      ok: false,
      code: input.supabaseUrl.startsWith("https://") ? "remote_requires_explicit_build_mode" : "binding_invalid",
    };
  }

  const allowlist = normalizeAllowlist(input.allowlist ?? []);
  if (!allowlist.ok) return { ok: false, code: "allowlist_invalid" };
  const origin = httpsOrigin(input.supabaseUrl);
  if (!origin.ok) return { ok: false, code: origin.reason === "https" ? "https_required" : "binding_invalid" };
  if (!allowlist.origins.has(origin.origin)) return { ok: false, code: "host_not_allowlisted" };
  return { ok: true, mode: "workers-build", url: origin.origin, key: input.publishableKey };
}

export function createWorkersBuildChildEnv(input: {
  parent: Record<string, string | undefined>;
  binding: { mode: WorkersBuildMode; url: string; key: string };
  allowlist: readonly string[];
  cacheNonce: string;
  pinnedPublication?: { path: string; sha256: string; releaseId: string };
}): Record<string, string> {
  if (!/^[a-f0-9]{32}$/.test(input.cacheNonce)) throw new Error("static_build_cache_nonce_invalid");
  const pinned = input.pinnedPublication;
  if (pinned && (!(path.win32.isAbsolute(pinned.path) || path.posix.isAbsolute(pinned.path))
    || /[\r\n\0]/.test(pinned.path) || !/^[a-f0-9]{64}$/.test(pinned.sha256)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(pinned.releaseId))) {
    throw new Error("static_build_publication_binding_invalid");
  }
  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV_KEYS) {
    const value = input.parent[key];
    if (value) env[key] = value;
  }
  env.AYPROM_STATIC_BUILD = "1";
  env.AYPROM_STATIC_BUILD_SUPABASE_URL = input.binding.url;
  env.AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY = input.binding.key;
  env.AYPROM_STATIC_BUILD_CACHE_NONCE = input.cacheNonce;
  if (pinned) {
    env.AYPROM_PUBLIC_CATALOG_READ_MODE = "pinned";
    env.AYPROM_PUBLIC_CATALOG_EXPORT_PATH = pinned.path;
    env.AYPROM_PUBLIC_CATALOG_EXPORT_SHA256 = pinned.sha256;
    env.AYPROM_PUBLIC_CATALOG_RELEASE_ID = pinned.releaseId;
  }
  env.NEXT_PUBLIC_SUPABASE_URL = "https://static-build.invalid";
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_diagnostic_only";
  env.NEXT_PUBLIC_SITE_URL = "https://www.ayprom-gidravlika.kg";
  env.NEXT_PUBLIC_MEDIA_BASE_URL = "https://media.ayprom-gidravlika.kg";
  env.NEXT_PUBLIC_HERO_MEDIA_SOURCE = "r2";
  env.NEXT_TELEMETRY_DISABLED = "1";
  if (input.binding.mode === "workers-build") {
    env.AYPROM_WORKERS_BUILD_MODE = "workers-build";
    env.AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST = input.allowlist.join(",");
  }
  return env;
}

function publicKeyKind(key: string): "publishable" | "anon" | "service" | "invalid" {
  const normalized = key.toLowerCase();
  if (normalized.startsWith("sb_secret_") || normalized.includes("service_role")) return "service";
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return "publishable";
  const parts = key.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0 || !/^[A-Za-z0-9_-]+$/.test(part))) return "invalid";
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { role?: unknown };
    if (payload.role === "service_role") return "service";
    if (payload.role === "anon") return "anon";
    return "invalid";
  } catch {
    return "invalid";
  }
}

function normalizeAllowlist(allowlist: readonly string[]): { ok: true; origins: Set<string> } | { ok: false } {
  if (allowlist.length === 0) return { ok: false };
  const origins = new Set<string>();
  for (const entry of allowlist) {
    if (entry.includes(".env") || entry.includes("..") || entry.includes("\\")) return { ok: false };
    const parsed = httpsOrigin(entry);
    if (!parsed.ok) return { ok: false };
    origins.add(parsed.origin);
  }
  return { ok: true, origins };
}

function httpsOrigin(value: string): { ok: true; origin: string } | { ok: false; reason: "https" | "invalid" } {
  let parsed: URL;
  try { parsed = new URL(value); } catch { return { ok: false, reason: "invalid" }; }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")) {
    return { ok: false, reason: "invalid" };
  }
  if (parsed.protocol !== "https:") return { ok: false, reason: "https" };
  const host = parsed.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".") || host === "localhost" || host.endsWith(".localhost") || isIp(host)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, origin: parsed.origin };
}

function isIp(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
}
