import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertLocalSupabaseUrl,
  assertPublicSupabaseKey,
  parseSupabaseStatusEnv,
} from "./postgrest-contract-lib.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const STATUS_URL_KEY = "CLOUDFLARE_POSTGREST_URL";
const STATUS_PUBLISHABLE_KEY = "CLOUDFLARE_POSTGREST_PUBLISHABLE_KEY";

try {
  const localEnv = readLocalSupabasePublicEnv();
  const vitestPath = path.join(
    PROJECT_ROOT,
    "node_modules",
    "vitest",
    "vitest.mjs",
  );
  const testPath = path.join(
    PROJECT_ROOT,
    "tests",
    "cloudflare-postgrest.integration.test.ts",
  );
  const result = spawnSync(process.execPath, [vitestPath, "run", testPath], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      CLOUDFLARE_POSTGREST_CONTRACT: "1",
      ...localEnv,
    },
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function readLocalSupabasePublicEnv() {
  const result = spawnSync(
    commandName("supabase"),
    [
      "status",
      "-o",
      "env",
      "--override-name",
      `api.url=${STATUS_URL_KEY}`,
      "--override-name",
      `auth.anon_key=${STATUS_PUBLISHABLE_KEY}`,
    ],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  if (result.error || result.status !== 0) {
    throw new Error(
      "Local Supabase недоступен. Запустите Docker и `supabase start`; вывод CLI скрыт, чтобы не раскрыть локальные ключи.",
    );
  }

  const status = parseSupabaseStatusEnv(result.stdout);
  const supabaseUrl = status.get(STATUS_URL_KEY) ?? "";
  const publishableKey = status.get(STATUS_PUBLISHABLE_KEY) ?? "";
  assertLocalSupabaseUrl(supabaseUrl);
  assertPublicSupabaseKey(publishableKey);

  return {
    [STATUS_URL_KEY]: supabaseUrl,
    [STATUS_PUBLISHABLE_KEY]: publishableKey,
  };
}

function commandName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}
