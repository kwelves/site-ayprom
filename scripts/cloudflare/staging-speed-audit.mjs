// Read-only audit of a LIVE staging address in real Chromium (cold cache, like a first-time visitor):
//  1. no broken image on any page (all sitemap pages + vehicle showcase thumbnails),
//  2. photo switching time on product pages,
//  3. page-to-page navigation time (with the hover that triggers speculative prerender),
//  4. search latency, first request vs repeated.
// Usage: node scripts/cloudflare/staging-speed-audit.mjs [origin] [--quick]
import { chromium } from "playwright";

const ORIGIN = (process.argv.find((a) => a.startsWith("https://")) ?? "https://ayprom-publication-staging.ayprom-migration.workers.dev").replace(/\/$/, "");
const QUICK = process.argv.includes("--quick");
const out = { origin: ORIGIN };
const note = (name) => process.stderr.write(JSON.stringify({ section: name, value: out[name] }) + "\n");
const pct = (values, p) => { const s = [...values].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : null; };

const sitemap = await (await fetch(`${ORIGIN}/sitemap.xml`)).text();
const paths = [...new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname))];
const pages = QUICK ? paths.filter((_p, i) => i % 6 === 0) : paths;
const browser = await chromium.launch({ headless: true });

// ---- 1. Broken images everywhere ----
async function auditPage(path) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const failed = [];
  page.on("response", (r) => { if (r.request().resourceType() === "image" && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  const transient = new Set();
  page.on("requestfailed", (r) => { if (r.resourceType() === "image") { transient.add(r.url().replace(/[?&]_r=d+/, "")); failed.push(`failed(${r.failure()?.errorText}) ${r.url()}`); } });
  try {
    await page.goto(ORIGIN + path, { waitUntil: "load", timeout: 45_000 });
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
    // The site retries a failed photo after 0.5, 1.5 and 3.5 s: judge only what is still broken afterwards.
    await page.waitForTimeout(6500);
    const broken = await page.evaluate(() => [...document.images].filter((i) => i.currentSrc && i.complete && i.naturalWidth === 0).map((i) => i.currentSrc));
    return { path, broken, recoveredAfterRetry: failed.length > 0 && broken.length === 0 ? failed.length : 0, firstFailures: failed.slice(0, 2) };
  } catch (error) { return { path, error: String(error.message).slice(0, 120), broken: failed }; }
  finally { await context.close(); }
}
const results = [];
let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => { while (cursor < pages.length) { results.push(await auditPage(pages[cursor++])); } }));
out.pagesChecked = results.length;
out.pagesWithBrokenImages = results.filter((r) => r.broken.length).map((r) => ({ path: r.path, broken: r.broken.slice(0, 3), firstFailures: r.firstFailures }));
out.transientFailuresRecoveredByRetry = results.reduce((sum, r) => sum + (r.recoveredAfterRetry ?? 0), 0);
note("transientFailuresRecoveredByRetry");
out.pageErrors = results.filter((r) => r.error).map((r) => `${r.path}: ${r.error}`).slice(0, 5);
// A picture still broken after the site's own retries is either a MISSING file (a real defect) or a dropped
// connection while many pictures load at once. Re-ask every such address directly to tell them apart.
const stillBroken = [...new Set(results.flatMap((r) => r.broken))];
const missingFiles = [];
for (const address of stillBroken) {
  try {
    const answer = await fetch(address, { signal: AbortSignal.timeout(20_000) });
    if (!(answer.status === 200 && (answer.headers.get("content-type") ?? "").startsWith("image/"))) missingFiles.push(`${answer.status} ${address}`);
    await answer.arrayBuffer();
  } catch { missingFiles.push(`unreachable ${address}`); }
}
out.brokenAfterRetries = stillBroken.length;
out.brokenBecauseFileIsMissing = missingFiles;
note("pagesChecked"); note("pagesWithBrokenImages"); note("pageErrors"); note("brokenAfterRetries"); note("brokenBecauseFileIsMissing");

// ---- 1b. Vehicle showcase: every thumbnail and its big photo ----
{
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const bad = [];
  page.on("response", (r) => { if (r.request().resourceType() === "image" && r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${ORIGIN}/#vehicle-showcase`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const thumbs = page.locator("#vehicle-showcase img");
  const count = await thumbs.count();
  const broken = await page.evaluate(() => [...document.querySelectorAll("#vehicle-showcase img")].filter((i) => i.currentSrc && i.complete && i.naturalWidth === 0).length);
  out.vehicleShowcase = { images: count, brokenAfterLoad: broken, failedRequests: bad.length };
  note("vehicleShowcase");
  await context.close();
}

// ---- 2. Photo switching on product pages (cold visitor) ----
const productPaths = paths.filter((p) => /^\/catalog\/category\/[^/]+\/(?:subcategory\/[^/]+\/|brand\/[^/]+\/)?[^/]+$/.test(p) && p.split("/").length >= 5);
const switchTimes = [], coldTimes = [];
let tested = 0;
for (const path of productPaths.slice(0, QUICK ? 40 : 120)) {
  if (tested >= (QUICK ? 6 : 12)) break;
  for (const waitMs of [1500, 0]) {
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto(ORIGIN + path, { waitUntil: "load" });
      const dots = page.getByRole("button", { name: /^Показать фото \d+$/ });
      const n = await dots.count();
      if (n < 3) { await context.close(); break; }
      if (waitMs) await page.waitForTimeout(waitMs);
      const elapsed = await page.evaluate(async (target) => {
        const layer = () => document.querySelector('[data-carousel-layer="committed"] img');
        const buttons = [...document.querySelectorAll("button[aria-label^='Показать фото']")];
        const start = performance.now();
        buttons[target].click();
        return await new Promise((resolve) => {
          const check = () => {
            const img = layer();
            const dot = buttons[target].getAttribute("aria-current") === "true";
            if (dot && img && img.complete && img.naturalWidth > 0 && img.currentSrc && !document.querySelector('[data-carousel-layer="pending"]')) resolve(performance.now() - start);
            else requestAnimationFrame(check);
          };
          check();
          setTimeout(() => resolve(-1), 5000);
        });
      }, n - 1);
      (waitMs ? switchTimes : coldTimes).push(elapsed);
    } catch { /* counted as missing */ } finally { await context.close(); }
  }
  tested += 1;
}
out.photoSwitch = { productsTested: tested, afterLoadPlus1500ms: { p50: pct(switchTimes, 0.5), max: pct(switchTimes, 1), failed: switchTimes.filter((t) => t < 0).length },
  immediatelyAfterLoad: { p50: pct(coldTimes, 0.5), max: pct(coldTimes, 1), failed: coldTimes.filter((t) => t < 0).length } };

note("photoSwitch");

// ---- 3. Navigation (hover first, as a visitor does before clicking) ----
try {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const samples = [];
  for (const [from, linkName] of [["/", "О нас"], ["/about", "Главная"], ["/catalog", null]]) {
    await page.goto(ORIGIN + from, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    const link = linkName ? page.getByRole("link", { name: linkName, exact: true }).first() : page.locator("main a[href^='/catalog/category/']").first();
    if (!(await link.count())) continue;
    // A product card's photo covers its stretched link: hover and press what a visitor really touches.
    const target = linkName ? link : link.locator("..").getByRole("img").first();
    await target.hover();
    await page.waitForTimeout(600);
    const started = Date.now();
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), target.click()]);
    const timing = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return { prerendered: n.activationStart > 0, activation: Math.round(n.activationStart) }; });
    samples.push({ from, clickToDomReadyMs: Date.now() - started, ...timing });
  }
  out.navigation = samples;
  await context.close();
} catch (error) { out.navigation = { error: String(error.message).slice(0, 160) }; }
note("navigation");

// ---- 4. Search latency: first vs repeated ----
{
  const query = `насос${Date.now() % 1000}`;
  const url = `${ORIGIN}/api/catalog/search?q=${encodeURIComponent(query)}`;
  const timings = [];
  const cacheHeaders = [];
  for (let i = 0; i < 6; i += 1) { const s = performance.now(); const r = await fetch(url); await r.arrayBuffer(); timings.push(Math.round(performance.now() - s)); cacheHeaders.push(r.headers.get("x-search-cache")); await new Promise((res) => setTimeout(res, 300)); }
  out.search = { timingsMs: timings, cache: cacheHeaders };
}

await browser.close();
out.ok = out.brokenBecauseFileIsMissing.length === 0 && out.vehicleShowcase.brokenAfterLoad === 0 && out.vehicleShowcase.failedRequests === 0;
console.log(JSON.stringify(out, null, 1));
process.exitCode = out.ok ? 0 : 1;
