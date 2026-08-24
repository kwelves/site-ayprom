import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(THIS_DIR, "../..");
const LOCAL_SUPABASE_PORT = "54321";
const DEFAULT_E2E_PORT = 3101;
const RESERVED_E2E_PORTS = new Set([3001, 54_321]);
export const E2E_ADMIN_PASSWORD = "qa-e2e-local-admin-password-only";
export const E2E_ADMIN_SESSION_SECRET = "qa-e2e-local-session-secret-only-32-bytes";

export function getE2EPort() {
  const port = Number(process.env.E2E_PORT ?? DEFAULT_E2E_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535 || RESERVED_E2E_PORTS.has(port)) {
    throw new Error("E2E_PORT должен быть валидным непривилегированным портом, отличным от app 3001 и local Supabase 54321.");
  }
  return port;
}

function commandName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function parseStatusEnv(output) {
  const values = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        throw new Error("Supabase CLI вернул env в неизвестном формате.");
      }
    }
    values.set(key, value);
  }
  return values;
}

function assertLocalHttpUrl(rawUrl, label, expectedPort) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label} не является корректным URL.`);
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.port !== expectedPort
  ) {
    throw new Error(`${label} должен указывать только на локальный порт ${expectedPort}.`);
  }
}

export function getPreflightFacts() {
  const npmVersion = process.env.npm_config_user_agent?.match(/(?:^|\s)npm\/([^\s]+)/)?.[1] ?? null;
  const docker = spawnSync(commandName("docker"), ["info", "--format", "{{.ServerVersion}}"], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    nodeVersion: process.version,
    npmVersion,
    requiredSecretsPresent: Boolean(E2E_ADMIN_PASSWORD && E2E_ADMIN_SESSION_SECRET),
    dockerAvailable: docker.status === 0,
    dockerVersion: docker.status === 0 ? docker.stdout.trim() : null,
  };
}

export function getVerifiedLocalRuntimeEnv() {
  const facts = getPreflightFacts();
  const e2ePort = getE2EPort();
  const localAppOrigin = `http://127.0.0.1:${e2ePort}`;
  if (!facts.requiredSecretsPresent) {
    throw new Error(
      "Для E2E нужны ADMIN_PASSWORD и ADMIN_SESSION_SECRET в .env.local или окружении; значения не выводятся.",
    );
  }
  if (!facts.dockerAvailable) {
    throw new Error(
      "Docker daemon недоступен. Запустите Docker-совместимый runtime и затем `supabase start`; remote Supabase использовать нельзя.",
    );
  }

  let rawStatus;
  try {
    rawStatus = execFileSync(
      commandName("supabase"),
      [
        "status",
        "-o",
        "env",
        "--override-name",
        "api.url=NEXT_PUBLIC_SUPABASE_URL",
        "--override-name",
        "auth.anon_key=NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "--override-name",
        "auth.service_role_key=SUPABASE_SECRET_KEY",
      ],
      {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
      },
    );
  } catch {
    throw new Error(
      "Local Supabase недоступен. Выполните `supabase start`; вывод CLI скрыт, чтобы не раскрыть локальные ключи.",
    );
  }

  const status = parseStatusEnv(rawStatus);
  const supabaseUrl = status.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
  const publishableKey = status.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? "";
  const secretKey = status.get("SUPABASE_SECRET_KEY") ?? "";

  assertLocalHttpUrl(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL", LOCAL_SUPABASE_PORT);
  if (!publishableKey || !secretKey) {
    throw new Error("Supabase CLI не вернул обязательные локальные ключи.");
  }

  return {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_SECRET_KEY: secretKey,
    ADMIN_PASSWORD: E2E_ADMIN_PASSWORD,
    ADMIN_SESSION_SECRET: E2E_ADMIN_SESSION_SECRET,
    E2E_ADMIN_PASSWORD,
    E2E_ADMIN_SESSION_SECRET,
    NEXT_PUBLIC_SITE_URL: localAppOrigin,
    E2E_BASE_URL: localAppOrigin,
    E2E_PORT: String(e2ePort),
    E2E_LOCAL_RUNTIME_VERIFIED: "1",
    SENTRY_DSN: "",
    NEXT_PUBLIC_SENTRY_DSN: "",
    SENTRY_AUTH_TOKEN: "",
    SUPABASE_TELEMETRY_DISABLED: "1",
  };
}
