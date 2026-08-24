import { spawnSync } from "node:child_process";
import path from "node:path";
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { getVerifiedLocalRuntimeEnv, PROJECT_ROOT } from "./local-runtime.mjs";

const args = process.argv.slice(2);
const shouldBuild = args.includes("--build");
const playwrightArgs = args.filter((arg) => arg !== "--build");
const runtimeEnv = getVerifiedLocalRuntimeEnv();

if (!existsSync(chromium.executablePath())) {
  throw new Error("Playwright Chromium не установлен. Выполните `npm run e2e:install`.");
}

function runNodeScript(scriptPath, scriptArgs) {
  const result = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    cwd: PROJECT_ROOT,
    env: runtimeEnv,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (shouldBuild) {
  runNodeScript(path.join(PROJECT_ROOT, "node_modules", "next", "dist", "bin", "next"), ["build"]);
}

runNodeScript(path.join(PROJECT_ROOT, "node_modules", "playwright", "cli.js"), ["test", ...playwrightArgs]);
