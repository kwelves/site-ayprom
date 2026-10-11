// Checks the remaining admin functions on the STAGING admin through the real pages:
//   audit log (rows, filter, page 2), vehicle showcase (edit a hotspot caption, save, check, restore),
//   and the password change (change, sign in with the new one, change back).
// Everything it changes is put back. Usage: node scripts/cloudflare/admin-misc-smoke.mjs [origin] [--skip-password]
// Password: env ADMIN_PASSWORD (never printed).
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const ORIGIN = (process.argv.find((arg) => arg.startsWith("http")) ?? "https://ayprom-admin-staging.ayprom-migration.workers.dev").replace(/\/$/, "");
const SKIP_PASSWORD = process.argv.includes("--skip-password");
const password = process.env.ADMIN_PASSWORD;
if (!password) throw new Error("ADMIN_PASSWORD is not set");

const browser = await chromium.launch({ headless: true });
const out = { origin: ORIGIN };
const clean = (text) => text.replace(/\s+/g, " ").trim();

async function signIn(page, secret) {
  await page.goto(`${ORIGIN}/admin/login`);
  await page.getByLabel("Пароль").fill(secret);
  await page.getByRole("button", { name: /Войти/ }).click();
  return page.waitForURL(/\/admin\/(welcome|products)/, { timeout: 20_000 }).then(() => true, () => false);
}

async function auditChecks(page) {
  const result = {};
  await page.goto(`${ORIGIN}/admin/audit`, { waitUntil: "load" });
  await page.getByRole("heading", { name: "Журнал изменений" }).waitFor({ timeout: 20_000 });
  result.rows = await page.locator("tbody tr").count();
  result.firstRow = clean(await page.locator("tbody tr").first().innerText().catch(() => "")).slice(0, 140);
  result.total = clean(await page.getByText(/Всего|записей|Записей/).first().innerText().catch(() => "")).slice(0, 80);
  for (const action of ["DELETE", "INSERT", "UPDATE"]) {
    await page.goto(`${ORIGIN}/admin/audit?action=${action}`, { waitUntil: "load" });
    await page.getByRole("heading", { name: "Журнал изменений" }).waitFor({ timeout: 20_000 });
    result[`filter_${action}`] = await page.locator("tbody tr").count();
  }
  await page.goto(`${ORIGIN}/admin/audit?page=2`, { waitUntil: "load" });
  await page.getByRole("heading", { name: "Журнал изменений" }).waitFor({ timeout: 20_000 });
  result.page2Rows = await page.locator("tbody tr").count();
  await page.goto(`${ORIGIN}/admin/audit`, { waitUntil: "load" });
  const toggle = page.locator("tbody tr").first().locator("summary, button").first();
  if (await toggle.count()) {
    await toggle.click();
    result.detailOpened = true;
  }
  return result;
}

async function showcaseChecks(page) {
  const result = {};
  await page.goto(`${ORIGIN}/admin/vehicle-showcase`, { waitUntil: "load" });
  await page.getByRole("heading", { name: "Спецтехника" }).waitFor({ timeout: 20_000 });
  const field = page.locator('section[aria-labelledby^="hotspot-"] input:not([type="hidden"])').first();
  await field.waitFor({ timeout: 20_000 });
  const original = await field.inputValue();
  const changed = `${original} ✓`;
  await field.fill(changed);
  await page.getByRole("button", { name: "Сохранить изменения" }).click();
  await page.getByRole("button", { name: "Сохранить изменения" }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(4000);
  result.messageAfterSave = clean(await page.locator("[role=alert], [role=status]").allInnerTexts().then((all) => all.join(" | ")).catch(() => "")).slice(0, 200);
  await page.reload({ waitUntil: "load" });
  const reloaded = page.locator('section[aria-labelledby^="hotspot-"] input:not([type="hidden"])').first();
  await reloaded.waitFor({ timeout: 20_000 });
  result.savedValueVisibleAfterReload = (await reloaded.inputValue()) === changed;
  await reloaded.fill(original);
  await page.getByRole("button", { name: "Сохранить изменения" }).click();
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: "load" });
  const restored = page.locator('section[aria-labelledby^="hotspot-"] input:not([type="hidden"])').first();
  await restored.waitFor({ timeout: 20_000 });
  result.restored = (await restored.inputValue()) === original;
  // Product search inside a hotspot.
  const search = page.locator('section[aria-labelledby^="hotspot-"] input[placeholder*="название или артикул"]').first();
  if (await search.count()) {
    await search.fill("вал");
    result.searchFoundProducts = await page.getByRole("button", { name: /Выбрать товар/ }).first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
  } else {
    result.searchFoundProducts = "search field not found";
  }
  return result;
}

async function passwordChecks(page) {
  const result = {};
  const temporary = `${password}Xx9!tmp`;
  const change = async (current, next) => {
    await page.goto(`${ORIGIN}/admin/security`, { waitUntil: "load" });
    await page.getByLabel("Текущий пароль").fill(current);
    await page.getByLabel("Новый пароль", { exact: true }).fill(next);
    await page.getByLabel("Повторите новый пароль").fill(next);
    await page.getByRole("button", { name: "Изменить пароль" }).click();
    await page.waitForTimeout(3500);
    return clean(await page.locator("main").innerText().catch(() => "")).slice(0, 200);
  };
  result.changeMessage = await change(password, temporary);
  const other = await (await browser.newContext()).newPage();
  result.signInWithNew = await signIn(other, temporary);
  const stale = await (await browser.newContext()).newPage();
  result.signInWithOldBlocked = !(await signIn(stale, password));
  await other.context().close();
  await stale.context().close();
  result.backMessage = await change(temporary, password);
  const again = await (await browser.newContext()).newPage();
  result.signInWithOriginalAfterRestore = await signIn(again, password);
  await again.context().close();
  if (!result.signInWithOriginalAfterRestore) {
    // Last resort: remove the stored credential so the Worker secret works again.
    const key = readFileSync(path.join(os.homedir(), ".ayprom-secrets", "supabase-staging-secret-key.txt"), "utf8").trim();
    const response = await fetch("https://jpmoxtqafgbqihvjhvri.supabase.co/rest/v1/admin_credentials?credential_key=eq.primary", { method: "DELETE", headers: { apikey: key } });
    result.recoveryDelete = response.status;
  }
  return result;
}

try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  if (!(await signIn(page, password))) throw new Error("sign in failed");
  const ONLY = process.env.ONLY;
  for (const [label, run] of [["audit", auditChecks], ["showcase", showcaseChecks], ...(SKIP_PASSWORD ? [] : [["password", passwordChecks]])].filter(([label]) => !ONLY || label === ONLY)) {
    try { out[label] = await run(page); } catch (error) { out[label] = { error: String(error.message ?? error).slice(0, 300) }; }
  }
} catch (error) {
  out.error = String(error.message ?? error).slice(0, 300);
} finally {
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
