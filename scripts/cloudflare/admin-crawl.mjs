// Opens every admin page (with real slugs taken from the data) in a real Chromium and reports pages that
// show the error screen, the not-found screen, no heading, or console errors.
// Usage: node scripts/cloudflare/admin-crawl.mjs [origin]    Password: env ADMIN_PASSWORD or .dev.vars.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const ORIGIN = (process.argv.find((arg) => arg.startsWith("http")) ?? "http://127.0.0.1:8788").replace(/\/$/, "");
function readPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const line = readFileSync(".dev.vars", "utf8").split(/\r?\n/).find((entry) => entry.startsWith("ADMIN_PASSWORD="));
  if (!line) throw new Error("ADMIN_PASSWORD is not available");
  return line.slice("ADMIN_PASSWORD=".length);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto(`${ORIGIN}/admin/login`);
await page.getByLabel("Пароль").fill(readPassword());
await page.getByRole("button", { name: /Войти/ }).click();
await page.waitForURL(/\/admin\/(welcome|products)/);

const rpc = (name, ...args) => page.evaluate(async ([action, input]) => {
  const response = await fetch(`/api/admin/rpc/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ args: input }) });
  return (await response.json()).value;
}, [name, args]);

const brands = await rpc("getAdminBrands");
const categories = await rpc("getAdminCategories");
const vehicleTypes = await rpc("getAdminVehicleTypes");
const products = (await rpc("getAdminProducts", { page: 1 }))?.items ?? (await rpc("getAdminProducts", {}))?.items ?? [];
const category = categories.find((entry) => entry.slug) ?? categories[0];
const subcategories = category ? await rpc("getAdminSubcategories", category.slug) : [];

const routes = [
  "/admin", "/admin/products", "/admin/products/new", "/admin/vehicle-showcase", "/admin/brands", "/admin/brands/new",
  "/admin/categories", "/admin/categories/new", "/admin/vehicle-types", "/admin/vehicle-types/new",
  "/admin/import", "/admin/audit", "/admin/security", "/admin/welcome",
];
if (products[0]) routes.push(`/admin/products/${products[0].slug}/edit`);
if (brands[0]) routes.push(`/admin/brands/${brands[0].slug}/edit`);
if (category) routes.push(`/admin/categories/${category.slug}/edit`, `/admin/categories/${category.slug}/subcategories`, `/admin/categories/${category.slug}/subcategories/new`, `/admin/categories/${category.slug}/category-brands`);
if (category && subcategories[0]) routes.push(`/admin/categories/${category.slug}/subcategories/${subcategories[0].slug}/edit`);
if (vehicleTypes[0]) routes.push(`/admin/vehicle-types/${vehicleTypes[0].slug}/edit`);

const results = [];
for (const route of routes) {
  const errors = [];
  const onConsole = (message) => { if (message.type() === "error") errors.push(message.text().slice(0, 160)); };
  const onPageError = (error) => errors.push(`pageerror ${String(error.message).slice(0, 160)}`);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  const started = Date.now();
  await page.goto(ORIGIN + route, { waitUntil: "load" });
  const settled = await page.waitForFunction((current) => {
    const text = document.body.innerText;
    return !document.querySelector(".animate-pulse") && (document.querySelector("main h1") || text.includes("Страница не найдена") || text.includes("Операция админки не выполнена") || current === "/admin/welcome");
  }, route, { timeout: 15_000 }).then(() => true).catch(() => false);
  const body = await page.locator("body").innerText();
  results.push({
    route,
    ms: Date.now() - started,
    heading: (await page.locator("h1").first().innerText().catch(() => "")).slice(0, 60),
    problem: !settled ? "never finished loading" : body.includes("Операция админки не выполнена") ? "error screen" : body.includes("Страница не найдена") ? "not found" : errors.length ? `console: ${errors[0]}` : null,
  });
  page.off("console", onConsole);
  page.off("pageerror", onPageError);
}
await browser.close();
console.log(JSON.stringify({ origin: ORIGIN, checked: results.length, problems: results.filter((r) => r.problem), pages: results.map((r) => `${r.ms}ms ${r.route} -> ${r.heading}`) }, null, 1));
process.exitCode = results.some((r) => r.problem) ? 1 : 0;
