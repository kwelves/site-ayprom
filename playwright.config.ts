import { defineConfig } from "@playwright/test";
import path from "node:path";

const DEFAULT_E2E_PORT = 3101;
const RESERVED_E2E_PORTS = new Set([3001, 54_321]);
const parsedE2EPort = Number(process.env.E2E_PORT ?? DEFAULT_E2E_PORT);
if (
  !Number.isInteger(parsedE2EPort) ||
  parsedE2EPort < 1024 ||
  parsedE2EPort > 65_535 ||
  RESERVED_E2E_PORTS.has(parsedE2EPort)
) {
  throw new Error("E2E_PORT должен быть валидным непривилегированным портом, отличным от app 3001 и local Supabase 54321.");
}

const DEFAULT_E2E_BASE_URL = `http://127.0.0.1:${parsedE2EPort}`;
const baseURL = process.env.E2E_BASE_URL ?? DEFAULT_E2E_BASE_URL;
const parsedBaseURL = new URL(baseURL);
const parsedSupabaseURL = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid.local");
const nextStartBinary = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const webServerEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && entry[0] !== "NO_COLOR" && entry[0] !== "FORCE_COLOR",
  ),
);

if (
  process.env.E2E_LOCAL_RUNTIME_VERIFIED !== "1" ||
  parsedBaseURL.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(parsedBaseURL.hostname) ||
  parsedBaseURL.port !== String(parsedE2EPort) ||
  parsedSupabaseURL.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(parsedSupabaseURL.hostname) ||
  parsedSupabaseURL.port !== "54321"
) {
  throw new Error(
    "Playwright E2E разрешено запускать только через npm run e2e* с проверенным local Supabase runtime.",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results/artifacts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Один воркер везде, а не только под CI. Публичные спеки создают fixtures
  // `qa-e2e-*` в общей локальной базе, а публичные страницы читают весь список
  // категорий (`src/lib/queries/categories.ts`). При нескольких воркерах чужая
  // fixture попадает в шапку и каталог соседнего теста, а её очистка обрывает
  // его навигацию: набор плавает по причинам, которых нет ни в продукте, ни в
  // контрактном прогоне. Прогон дольше, зато локальный результат совпадает с CI.
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL,
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    // Let Playwright own the actual Next child directly. A nested Windows
    // wrapper raced Ctrl+C/process-tree cleanup and produced UV_HANDLE_CLOSING.
    command: `"${process.execPath}" "${nextStartBinary}" start -H 127.0.0.1 -p ${parsedE2EPort}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: webServerEnv,
  },
  projects: [
    {
      name: "auth-setup",
      testMatch: /setup\/.*\.setup\.ts/,
      teardown: "auth-cleanup",
      use: { viewport: { width: 1440, height: 1000 }, trace: "off" },
    },
    {
      name: "auth-cleanup",
      testMatch: /setup\/.*\.teardown\.ts/,
      use: { viewport: { width: 1440, height: 1000 }, trace: "off" },
    },
    {
      name: "public",
      testMatch: /public\/.*\.spec\.ts/,
      use: { viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "admin",
      testMatch: /admin\/.*\.spec\.ts/,
      dependencies: ["auth-setup"],
      use: {
        viewport: { width: 1440, height: 1000 },
        storageState: ".playwright-state/auth/admin.json",
        trace: "off",
      },
    },
  ],
});
