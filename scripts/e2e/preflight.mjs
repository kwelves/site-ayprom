import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { getE2EPort, getPreflightFacts, getVerifiedLocalRuntimeEnv } from "./local-runtime.mjs";

const facts = getPreflightFacts();
const browserInstalled = existsSync(chromium.executablePath());

console.log(`Node: ${facts.nodeVersion}`);
console.log(`npm: ${facts.npmVersion ?? "версия не определена"}`);
console.log(`Docker daemon: ${facts.dockerAvailable ? `доступен (${facts.dockerVersion})` : "недоступен"}`);
console.log(`Изолированные E2E admin env: ${facts.requiredSecretsPresent ? "подготовлены runtime guard" : "не подготовлены"}`);
console.log(`Playwright Chromium: ${browserInstalled ? "установлен" : "не установлен"}`);
console.log(`Изолированный app port: ${getE2EPort()}`);

getVerifiedLocalRuntimeEnv();
console.log("Local Supabase: проверен; E2E runtime изолирован от remote .env.local.");

if (!browserInstalled) {
  throw new Error("Chromium не установлен. Выполните `npm run e2e:install`.");
}
