// End-to-end check of publication after an edit on the STAGING admin: rename one product through the real form,
// time how long the public staging site takes to show the new name, then restore the name and wait again.
// Usage: node scripts/cloudflare/admin-publication-smoke.mjs [adminOrigin] [publicOrigin]
// Password: env ADMIN_PASSWORD or the staging password file.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const ORIGINS = process.argv.filter((arg) => arg.startsWith("http")).map((arg) => arg.replace(/\/$/, ""));
const ADMIN = ORIGINS[0] ?? "https://ayprom-admin-staging.ayprom-migration.workers.dev";
const PUBLIC = ORIGINS[1] ?? "https://ayprom-publication-staging.ayprom-migration.workers.dev";
const password = process.env.ADMIN_PASSWORD ?? readFileSync(path.join(os.homedir(), ".ayprom-secrets", "admin-staging-password.txt"), "utf8").trim();
const MAX_WAIT_MS = 15 * 60_000;

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const rpc = (name, ...args) => page.evaluate(async ([action, input]) => {
  const response = await fetch(`/api/admin/rpc/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ args: input }) });
  return { status: response.status, value: (await response.json()).value };
}, [name, args]);
const seconds = (since) => Math.round((Date.now() - since) / 100) / 10;
const states = [];

async function waitForPublicName(name, since, gone = false) {
  while (Date.now() - since < MAX_WAIT_MS) {
    const status = (await rpc("fetchPublicationStatus")).value;
    if (states.at(-1)?.state !== status?.state) states.push({ state: status?.state, at: seconds(since) });
    const response = await fetch(`${PUBLIC}/api/catalog/search?q=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    const text = response?.ok ? await response.text() : "";
    if (response?.ok && text.includes(name) !== gone) return seconds(since);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return null;
}

async function rename(slug, value) {
  await page.goto(`${ADMIN}/admin/products/${slug}/edit`, { waitUntil: "load" });
  await page.getByLabel("Название").fill(value);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await page.waitForURL(/\/admin\/products(\?.*)?$/, { timeout: 30_000 });
}

const out = { admin: ADMIN, public: PUBLIC };
try {
  await page.goto(`${ADMIN}/admin/login`);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: /Войти/ }).click();
  await page.waitForURL(/\/admin\/(welcome|products)/);

  const first = (await rpc("getAdminProducts", {})).value.items[0];
  const original = (await rpc("getAdminProduct", first.slug)).value.name;
  const marker = `${original} PUBTEST${String(Date.now()).slice(-5)}`;
  out.product = first.slug;
  out.statusBefore = (await rpc("fetchPublicationStatus")).value?.state;

  let started = Date.now();
  await rename(first.slug, marker);
  out.savedAfterSeconds = seconds(started);
  await page.getByRole("status").filter({ hasText: /публикации|Публикуется/ }).first().waitFor({ timeout: 40_000 }).catch(() => undefined);
  out.badgeShownAfterSeconds = seconds(started);
  out.publicShowsNewNameAfterSeconds = await waitForPublicName(marker, started);
  out.states = [...states];
  states.length = 0;

  started = Date.now();
  await rename(first.slug, original);
  out.restoredGoneAfterSeconds = await waitForPublicName(marker, started, true);
  const finalStatus = (await rpc("fetchPublicationStatus")).value;
  out.finalState = finalStatus?.state;
} catch (error) {
  out.error = String(error.message ?? error).slice(0, 400);
} finally {
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
