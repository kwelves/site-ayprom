// End-to-end check of the CSV import on the STAGING admin: upload a small CSV through the real page, read the
// preview, confirm the import, check the product exists, then delete it again. Also tries a larger file
// (about 1500 rows) for the preview step to see how the Worker copes with a big file.
// Usage: node scripts/cloudflare/admin-import-smoke.mjs [origin] [--big]    Password: env ADMIN_PASSWORD.
import { chromium } from "playwright";

const ORIGIN = (process.argv.find((arg) => arg.startsWith("http")) ?? "https://ayprom-admin-staging.ayprom-migration.workers.dev").replace(/\/$/, "");
const BIG = process.argv.includes("--big");
const COMMIT_ROWS = Number((process.argv.find((arg) => arg.startsWith("--commit-rows=")) ?? "").slice("--commit-rows=".length)) || 0;
const password = process.env.ADMIN_PASSWORD;
if (!password) throw new Error("ADMIN_PASSWORD is not set");

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const rpc = (name, ...args) => page.evaluate(async ([action, input]) => {
  const response = await fetch(`/api/admin/rpc/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ args: input }) });
  return { status: response.status, value: (await response.json()).value };
}, [name, args]);

const stamp = Date.now().toString(36);
const out = { origin: ORIGIN };
async function cleanupBulk() {
  if (COMMIT_ROWS <= 0) return "not used";
  const key = (await import("node:fs")).readFileSync(`${(await import("node:os")).homedir()}/.ayprom-secrets/supabase-staging-secret-key.txt`, "utf8").trim();
  const base = "https://jpmoxtqafgbqihvjhvri.supabase.co/rest/v1/products";
  const response = await fetch(`${base}?article=like.${encodeURIComponent(`BULK-${stamp}-*`)}`, { method: "DELETE", headers: { apikey: key, prefer: "return=representation" } });
  const removed = response.ok ? (await response.json()).length : -response.status;
  return removed;
}

const name = `Import smoke ${stamp}`;
const slug = `import-smoke-${stamp}`;
try {
  await page.goto(`${ORIGIN}/admin/login`);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: /Войти/ }).click();
  await page.waitForURL(/\/admin\/(welcome|products)/);

  const categories = (await rpc("getCategories")).value;
  const category = categories[0].slug;
  out.category = category;

  const header = "name,article,category,short_description,published";
  const csv = [header, `${name},SMOKE-${stamp},${category},Проверка импорта на staging,false`].join("\n");

  await page.goto(`${ORIGIN}/admin/import`, { waitUntil: "load" });
  let started = Date.now();
  await page.locator('input[type="file"]').setInputFiles({ name: "smoke.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await page.getByText(/Прочитано строк: 1/).waitFor({ timeout: 60_000 });
  out.previewSeconds = (Date.now() - started) / 1000;
  out.previewText = (await page.getByText(/Создать:/).first().innerText()).trim();

  started = Date.now();
  await page.getByRole("button", { name: /Подтвердить импорт/ }).click();
  await page.getByText(/Импорт завершён|Импортировать ещё файл/).first().waitFor({ timeout: 60_000 });
  out.commitSeconds = (Date.now() - started) / 1000;

  const created = (await rpc("getAdminProduct", slug)).value;
  out.createdProduct = created ? { name: created.name, published: created.published } : null;

  if (BIG) {
    const rows = [header];
    for (let i = 0; i < 1500; i += 1) rows.push(`Big smoke ${stamp} ${i},BIG-${stamp}-${i},${category},Строка ${i} большого файла,false`);
    const bigCsv = Buffer.from(rows.join("\n"), "utf8");
    out.bigFileKb = Math.round(bigCsv.length / 1024);
    await page.goto(`${ORIGIN}/admin/import`, { waitUntil: "load" });
    started = Date.now();
    await page.locator('input[type="file"]').setInputFiles({ name: "big.csv", mimeType: "text/csv", buffer: bigCsv });
    const shown = await page.getByText(/Прочитано строк: 1500/).waitFor({ timeout: 90_000 }).then(() => true, () => false);
    out.bigPreviewOk = shown;
    out.bigPreviewSeconds = (Date.now() - started) / 1000;
    if (!shown) out.bigPreviewPage = (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
  }
  if (COMMIT_ROWS > 0) {
    const rows = [header];
    for (let i = 0; i < COMMIT_ROWS; i += 1) rows.push(`Bulk smoke ${stamp} ${i},BULK-${stamp}-${i},${category},Строка ${i} массового импорта,false`);
    await page.goto(`${ORIGIN}/admin/import`, { waitUntil: "load" });
    await page.locator('input[type="file"]').setInputFiles({ name: "bulk.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n"), "utf8") });
    await page.getByText(new RegExp(`Прочитано строк: ${COMMIT_ROWS}`)).waitFor({ timeout: 90_000 });
    started = Date.now();
    await page.getByRole("button", { name: /Подтвердить импорт/ }).click();
    const finished = await page.getByText(/Импорт завершён|Импортировать ещё файл/).first().waitFor({ timeout: 120_000 }).then(() => true, () => false);
    out.bulkCommit = { rows: COMMIT_ROWS, finished, seconds: (Date.now() - started) / 1000, page: finished ? (await page.getByText(/создан|Создано/i).first().innerText().catch(() => "")).slice(0, 120) : (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 200) };
  }
} catch (error) {
  out.error = String(error.message ?? error).slice(0, 500);
} finally {
  out.bulkCleanup = await cleanupBulk();
  try { out.cleanup = (await rpc("deleteProduct", slug, false)).status; } catch { out.cleanup = "failed"; }
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
