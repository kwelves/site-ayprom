// Drives the admin SPA in a real Chromium: login, section navigation, timing of every click.
// Usage: node scripts/cloudflare/admin-smoke.mjs [origin] [--shots=<dir>]
// Password: env ADMIN_PASSWORD, or ADMIN_PASSWORD in .dev.vars (local runs). It is never printed.
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const ORIGIN = (process.argv.find((arg) => arg.startsWith("http")) ?? "http://127.0.0.1:8788").replace(/\/$/, "");
const WRITE = process.argv.includes("--write");
const shotsDir = process.argv.find((arg) => arg.startsWith("--shots="))?.slice("--shots=".length);
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

function readPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const line = readFileSync(".dev.vars", "utf8").split(/\r?\n/).find((entry) => entry.startsWith("ADMIN_PASSWORD="));
  if (!line) throw new Error("ADMIN_PASSWORD is not available");
  return line.slice("ADMIN_PASSWORD=".length);
}

const report = { origin: ORIGIN, steps: [], timings: {}, consoleErrors: [] };
const step = (name, value) => { report.steps.push({ name, ...value }); process.stderr.write(`${name}: ${JSON.stringify(value)}\n`); };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("console", (message) => { if (message.type() === "error") report.consoleErrors.push(message.text().slice(0, 200)); });
page.on("pageerror", (error) => report.consoleErrors.push(`pageerror ${String(error.message).slice(0, 200)}`));
const shot = async (name) => { if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `${name}.png`) }); };

// 1. A visitor without a session lands on the login form.
await page.goto(`${ORIGIN}/admin/brands`, { waitUntil: "load" });
await page.waitForURL(/\/admin\/login/, { timeout: 15_000 });
step("redirected-to-login", { url: page.url().replace(ORIGIN, "") });
await shot("1-login");

// 2. Wrong password shows the same error as before; the right one enters.
await page.getByLabel("Пароль").fill("definitely-wrong-password");
await page.getByRole("button", { name: /Войти/ }).click();
await page.waitForURL(/error=1/, { timeout: 15_000 });
step("wrong-password", { url: page.url().replace(ORIGIN, ""), message: await page.getByRole("alert").first().innerText() });
await page.getByLabel("Пароль").fill(readPassword());
const loginStarted = Date.now();
await page.getByRole("button", { name: /Войти/ }).click();
await page.waitForURL(/\/admin\/(welcome|products)/, { timeout: 20_000 });
report.timings.loginMs = Date.now() - loginStarted;
step("logged-in", { url: page.url().replace(ORIGIN, ""), ms: report.timings.loginMs });
await page.waitForURL(/\/admin\/products/, { timeout: 20_000 }).catch(() => undefined);
await page.waitForSelector("[data-testid='admin-shell']", { timeout: 20_000 });
await shot("2-after-login");

// 3. Every section opens; time from click to the new heading being visible (as a person sees it).
async function clickAndWaitForHeading(locator, heading, timeoutMs = 10_000) {
  const element = await locator.elementHandle();
  return page.evaluate(([target, expected, limit]) => new Promise((resolve) => {
    const started = performance.now();
    target.click();
    const tick = () => {
      const ready = document.querySelector("main h1")?.textContent?.trim() === expected && !document.querySelector(".animate-pulse");
      if (ready) resolve(Math.round(performance.now() - started));
      else if (performance.now() - started > limit) resolve(-1);
      else requestAnimationFrame(tick);
    };
    tick();
  }), [element, heading, timeoutMs]);
}
const sections = ["Бренды", "Категории", "Товары", "Бренды", "Категории", "Товары"];
report.timings.navigation = [];
for (const label of sections) {
  const link = page.locator("[data-testid='admin-sidebar']").getByRole("link", { name: label, exact: true });
  const ms = await clickAndWaitForHeading(link, label);
  report.timings.navigation.push({ to: label, ms });
  step("open-" + label, { ms });
}
await shot("3-products");

// 4. (--write, staging only) create a brand with a logo, see it, delete it: the full write round trip.
if (WRITE) {
  const logo = await sharp({ create: { width: 96, height: 96, channels: 3, background: { r: 8, g: 75, b: 185 } } }).png().toBuffer();
  const brandName = "Smoke Test " + (Date.now() % 100000);
  await page.locator("[data-testid='admin-sidebar']").getByRole("link", { name: "Бренды", exact: true }).click();
  await page.getByRole("link", { name: "Добавить бренд" }).first().click();
  await page.locator("#name").waitFor();
  await page.locator("#name").fill(brandName);
  await page.locator("#country").fill("KG");
  await page.locator("#logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: logo });
  const created = Date.now();
  await page.getByRole("button", { name: "Создать бренд" }).click();
  await page.waitForURL((url) => url.pathname === "/admin/brands" && url.searchParams.has("created"), { timeout: 30_000 });
  await page.getByText(brandName, { exact: true }).waitFor({ timeout: 15_000 });
  report.timings.createBrandMs = Date.now() - created;
  step("brand-created", { ms: report.timings.createBrandMs, url: page.url().replace(ORIGIN, "") });
  await shot("4-brand-created");
  const row = page.locator("div", { has: page.getByText(brandName, { exact: true }) }).filter({ has: page.getByRole("button", { name: "Удалить" }) }).last();
  await row.getByRole("button", { name: "Удалить" }).click();
  const confirmButton = page.getByRole("alertdialog").getByRole("button", { name: "Удалить" });
  await confirmButton.waitFor();
  const serverAnswered = page.waitForResponse((response) => response.url().includes("/rpc/deleteBrand"), { timeout: 20_000 });
  const gone = await page.evaluate(([name]) => new Promise((resolve) => {
    const started = performance.now();
    [...document.querySelectorAll("[role='alertdialog'] button")].find((b) => b.textContent.trim() === "Удалить").click();
    const tick = () => {
      if (!document.body.innerText.includes(name)) resolve(Math.round(performance.now() - started));
      else if (performance.now() - started > 10000) resolve(-1);
      else requestAnimationFrame(tick);
    };
    tick();
  }), [brandName]);
  report.timings.deleteBrandMs = gone;
  const answer = await serverAnswered;
  step("brand-deleted", { ms: gone, serverStatus: answer.status(), serverBody: (await answer.text()).slice(0, 120) });
  // The deletion must really have reached the database.
  await page.reload({ waitUntil: "load" });
  await page.locator("main h1").first().waitFor();
  step("brand-gone-after-reload", { stillThere: await page.getByText(brandName, { exact: true }).count() });

  // 5. SVG logos: a real one is accepted (and stays a vector), a hostile one is refused with a clear message.
  const openNewBrand = async () => {
    await page.goto(`${ORIGIN}/admin/brands/new`, { waitUntil: "load" });
    await page.locator("#name").waitFor();
  };
  const svgName = "Smoke SVG " + (Date.now() % 100000);
  await openNewBrand();
  await page.locator("#name").fill(svgName);
  await page.locator("#country").fill("KG");
  await page.locator("#logo").setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: readFileSync("public/brands-icons-svg/kamaz-logo.svg") });
  await page.getByRole("button", { name: "Создать бренд" }).click();
  await page.waitForURL((url) => url.pathname === "/admin/brands", { timeout: 30_000 });
  await page.getByText(svgName, { exact: true }).waitFor({ timeout: 15_000 });
  const logoUrl = await page.evaluate(async () => {
    const response = await fetch("/api/admin/rpc/getAdminBrands", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ args: [] }) });
    return (await response.json()).value;
  });
  const svgBrand = logoUrl.find((brand) => brand.name === svgName);
  const logoHead = svgBrand?.logo ? await (await fetch(new URL(svgBrand.logo, ORIGIN).href)).text().catch(() => "") : "";
  step("svg-logo-accepted", { slug: svgBrand?.slug, storedAsSvg: /^\s*<svg/i.test(logoHead) || /\.svg(\?|$)/.test(svgBrand?.logo ?? "") });
  await page.evaluate(async (slug) => {
    await fetch("/api/admin/rpc/deleteBrand", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ args: [slug] }) });
  }, svgBrand?.slug);

  await openNewBrand();
  await page.locator("#name").fill("Smoke Hostile " + (Date.now() % 100000));
  await page.locator("#country").fill("KG");
  await page.locator("#logo").setInputFiles({ name: "evil.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>') });
  await page.getByRole("button", { name: "Создать бренд" }).click();
  const refusal = await page.getByRole("alert").first().innerText({ timeout: 20_000 }).catch(() => "no message shown");
  step("hostile-svg-refused", { stayedOnForm: page.url().includes("/admin/brands/new"), message: refusal.slice(0, 140) });
}

report.consoleErrors = [...new Set(report.consoleErrors)].slice(0, 8);
console.log(JSON.stringify(report, null, 1));
await browser.close();
