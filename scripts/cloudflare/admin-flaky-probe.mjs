// Diagnoses pages that sometimes never finish loading on the STAGING admin: opens a few routes several times and
// reports every request that fails or answers with an error, with its status and time.
// Usage: node scripts/cloudflare/admin-flaky-probe.mjs [origin] [rounds]    Password: env ADMIN_PASSWORD.
import { chromium } from "playwright";

const ORIGIN = (process.argv.find((arg) => arg.startsWith("http")) ?? "https://ayprom-admin-staging.ayprom-migration.workers.dev").replace(/\/$/, "");
const ROUNDS = Number(process.argv.find((arg) => /^\d+$/.test(arg)) ?? 4);
const ROUTES = ["/admin/categories", "/admin/categories/pto/subcategories/new", "/admin/categories/pto/category-brands", "/admin/vehicle-types/samosval/edit", "/admin/audit"];
const password = process.env.ADMIN_PASSWORD;
if (!password) throw new Error("ADMIN_PASSWORD is not set");

const browser = await chromium.launch({ headless: true, args: (process.env.PROBE_ARGS ?? "").split(" ").filter(Boolean) });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const events = [];
let current = "";
const startedAt = new Map();
const pending = new Set();
const trace = [];
const T0 = Date.now();
page.on("requestfinished", (r) => trace.push(`${Date.now() - T0} done ${new URL(r.url()).pathname.slice(0, 60)}`));
page.on("request", (r) => trace.push(`${Date.now() - T0} start ${r.method()} ${new URL(r.url()).pathname.slice(0, 60)}`));
const consoleErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 200)); });
page.on("pageerror", (error) => consoleErrors.push("pageerror: " + String(error.message).slice(0, 200)));
page.on("requestfinished", (request) => pending.delete(request));
page.on("request", (request) => { startedAt.set(request, Date.now()); pending.add(request); });
page.on("response", async (response) => {
  const url = new URL(response.url());
  if (response.status() >= 400 && url.pathname.startsWith("/api/")) {
    const body = (await response.text().catch(() => "")).slice(0, 200).replace(/\s+/g, " ");
    events.push({ route: current, api: url.pathname, status: response.status(), ms: Date.now() - (startedAt.get(response.request()) ?? Date.now()), body });
  }
});
page.on("requestfailed", (request) => {
  const url = new URL(request.url());
  if (url.pathname.startsWith("/api/")) events.push({ route: current, api: url.pathname, failed: request.failure()?.errorText, ms: Date.now() - (startedAt.get(request) ?? Date.now()) });
});

await page.goto(`${ORIGIN}/admin/login`);
await page.getByLabel("Пароль").fill(password);
await page.getByRole("button", { name: /Войти/ }).click();
await page.waitForURL(/\/admin\/(welcome|products)/);

const results = [];
for (let round = 0; round < ROUNDS; round += 1) {
  for (const route of ROUTES) {
    current = route;
    const started = Date.now();
    await page.goto(`${ORIGIN}${route}`, { waitUntil: "domcontentloaded" });
    const done = await page.waitForFunction(() => !document.querySelector(".animate-pulse") && document.querySelector("main h1"), null, { timeout: Number(process.env.PROBE_WAIT_MS ?? 15000) }).then(() => true, () => false);
    results.push({ round, route, ok: done, ms: Date.now() - started, ...(done ? {} : { stillPending: [...pending].map((r) => new URL(r.url()).pathname + " (" + Math.round((Date.now() - (startedAt.get(r) ?? Date.now())) / 1000) + "s)").slice(0, 6), pulses: await page.locator(".animate-pulse").evaluateAll((nodes) => nodes.map((n) => (n.closest("[role=status]") ? "status-badge" : n.className.toString().slice(0, 40)))).catch(() => []), bodyText: (await page.locator("body").innerText().catch(() => "")).replace(/s+/g, " ").slice(0, 160) }) });
  }
}
await browser.close();
const failed = results.filter((entry) => !entry.ok);
console.log(JSON.stringify({ origin: ORIGIN, total: results.length, failed: failed.length, failedPages: failed, slowest: [...results].sort((a, b) => b.ms - a.ms).slice(0, 3), apiErrors: events.slice(0, 15), trace: process.env.TRACE ? trace.slice(0, 120) : undefined, consoleErrors: consoleErrors.slice(0, 8) }, null, 1));
