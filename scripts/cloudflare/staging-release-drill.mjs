// Remote STAGING release and rollback drill. Real: staging Supabase copy, real pinned builds,
// real Cloudflare Worker (ayprom-publication-staging), real activation and rollback via Wrangler,
// real Chromium against the workers.dev address. NOT production: no production database, domain,
// DNS or Vercel is touched. Secrets are read from ~/.ayprom-secrets and never printed.
// Usage: node scripts/cloudflare/staging-release-drill.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { inspectPublicationPackage } from "./publication-package-inspector.mjs";
import { runWorkersBuildEntry } from "./workers-build-runner-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STAGING_URL = "https://jpmoxtqafgbqihvjhvri.supabase.co";
const STAGING_PUBLISHABLE = "sb_publishable_yxS4_LQqsdPRtWxxUgg8-g_jQdYsJci"; // public by design
const ACCOUNT_ID = "5542d171bab5b5af3202e36e217f6ef9";
const SUBDOMAIN = "ayprom-migration";
const WORKER = "ayprom-publication-staging";
const LIVE = `https://${WORKER}.${SUBDOMAIN}.workers.dev`;
const WRANGLER = path.join(ROOT, ".wrangler/tools/wrangler-4.135.0/node_modules/wrangler/bin/wrangler.js");
const secretDir = path.join(os.homedir(), ".ayprom-secrets");
const read = (name) => readFileSync(path.join(secretDir, name), "utf8").trim();
const cloudflareToken = read("cloudflare-token.txt");
const stagingSecret = read("supabase-staging-secret-key.txt");
assert.ok(STAGING_URL.startsWith("https://jpmoxtqafgbqihvjhvri."), "staging only");
const secrets = [cloudflareToken, stagingSecret];
const hide = (value) => secrets.reduce((text, secret) => text.replaceAll(secret, "[hidden]"), String(value));
const step = (name, extra = {}) => process.stderr.write(hide(JSON.stringify({ step: name, ...extra })) + "\n");

register(pathToFileURL(path.join(ROOT, "scripts/cloudflare/static-producer-loader.mjs")).href,
  { parentURL: import.meta.url, data: { srcRoot: path.join(ROOT, "src") } });
const load = (relative) => import(pathToFileURL(path.join(ROOT, "src/cloudflare", relative)).href);
const [{ createPublicationControlClient }, { createPublicationQueueClient }, { createReleaseJournal },
  { publishCandidate }, { createWranglerReleasePort }] = await Promise.all([
  load("publication/publication-control.ts"), load("static-build/producer/publication-queue.ts"),
  load("publication/release-journal.ts"), load("publication/release-coordinator.ts"),
  load("publication/wrangler-inactive-port.ts")]);
const bindings = { SUPABASE_URL: STAGING_URL, PUBLICATION_SUPABASE_KEY: stagingSecret };
const control = createPublicationControlClient(bindings);
const queue = createPublicationQueueClient(bindings);
const publicRpc = async (name, body) => {
  const response = await fetch(`${STAGING_URL}/rest/v1/rpc/${name}`, { method: "POST", signal: AbortSignal.timeout(15_000),
    headers: { apikey: STAGING_PUBLISHABLE, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  return response.json();
};
const rest = async (method, pathAndQuery, body) => {
  const response = await fetch(`${STAGING_URL}/rest/v1/${pathAndQuery}`, { method, signal: AbortSignal.timeout(20_000),
    headers: { apikey: stagingSecret, authorization: `Bearer ${stagingSecret}`, "content-type": "application/json",
      prefer: "return=minimal" }, body: body ? JSON.stringify(body) : undefined });
  assert.ok(response.ok, `staging write failed ${response.status}`);
};

// ---- Test product (a real product of the copied catalog). ----
// A category with direct product pages (not brand-type), so the canonical path is /catalog/category/<c>/<slug>.
const sample = (await publicRpc("search_catalog_products", { category_filter: "gidravlicheskie-masloohladiteli" }))[0];
assert.ok(sample?.slug && sample.category_slug);
// Earlier aborted drills may have left a suffix on the staging copy; the true name has none.
const SLUG = sample.slug, CATEGORY = sample.category_slug, ORIGINAL = sample.name.replace(/(?: \(staging [ABC]\))+$/, "");
const PRODUCT_PATH = `/catalog/category/${CATEGORY}/${SLUG}`;
const rename = (name) => rest("PATCH", `products?slug=eq.${encodeURIComponent(SLUG)}`, { name });
const pointerName = async () => (await publicRpc("read_catalog_publication_document", { kind: "product", key: SLUG }))?.name;

// ---- Observations of a Cloudflare address. ----
async function until(check, label, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try { if (await check()) return true; } catch (error) { last = hide(error?.message ?? error); }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`timeout waiting for ${label}${last ? `: ${last}` : ""}`);
}
const show = async (origin, name) => {
  const page = await fetch(origin + PRODUCT_PATH, { signal: AbortSignal.timeout(20_000) });
  const search = await fetch(`${origin}/api/catalog/search?q=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(20_000) });
  if (page.status !== 200 || search.status !== 200) return false;
  const items = (await search.json()).items ?? [];
  return (await page.text()).includes(name) && items.some((item) => item.slug === SLUG && item.name === name);
};
const hidden = async (origin, name) => {
  const search = await fetch(`${origin}/api/catalog/search?q=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(20_000) });
  // Exact name: word-by-word search also matches a similarly named product, so compare names, not counts.
  return search.status === 200 && ((await search.json()).items ?? []).every((item) => item.name !== name);
};
let browserInstance;
async function browserCheck(origin, name) {
  browserInstance ??= await chromium.launch({ headless: true });
  const context = await browserInstance.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  let pageErrors = 0;
  page.on("pageerror", () => { pageErrors += 1; });
  try {
    page.setDefaultTimeout(30_000);
    const opened = await page.goto(`${origin}/catalog?q=${encodeURIComponent(name)}`, { waitUntil: "networkidle" });
    assert.equal(opened?.status(), 200);
    const link = page.getByRole("link", { name, exact: true }).first();
    await link.waitFor();
    assert.equal(new URL(await link.getAttribute("href"), origin).pathname, PRODUCT_PATH);
    // The card's photo sits above its stretched link and takes the tap: click what a visitor can click.
    const photo = link.locator("..").getByRole("img").first();
    if (await photo.count()) await photo.click(); else await link.click();
    await page.waitForURL((url) => url.pathname === PRODUCT_PATH);
    await page.getByRole("heading", { level: 1, name, exact: true }).waitFor();
    assert.equal(pageErrors, 0);
    return true;
  } finally { await context.close(); }
}

// ---- Build one real pinned package from the staging catalog. ----
let builds = 0;
const releases = new Map();
async function buildRelease(name) {
  await rename(name);
  builds += 1;
  const packageDir = path.join(ROOT, "dist/worker-packages", `staging-drill-${Date.now().toString(36)}-${builds}`);
  const { outcome, pinned } = await runWorkersBuildEntry({
    env: { ...process.env, AYPROM_WORKERS_BUILD_MODE: "workers-build", AYPROM_WORKERS_BUILD_SUPABASE_URL: STAGING_URL,
      AYPROM_WORKERS_BUILD_SUPABASE_PUBLISHABLE_KEY: STAGING_PUBLISHABLE, AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST: STAGING_URL,
      ADMIN_SUPABASE_KEY: stagingSecret },
    argv: ["--staging-pinned", "--published", path.join(ROOT, "dist/worker-packages/staging-previous-absent"), "--package", packageDir],
    probe: { query: name, expectedName: name, slug: SLUG, categorySlug: CATEGORY } });
  assert.equal(outcome.ok, true, `build failed: ${outcome.code}/${outcome.stage} ${JSON.stringify(
    { runtime: outcome.pinnedRuntimeDetail, browserStage: outcome.pinnedBrowserStage, browserReason: outcome.pinnedBrowserReason })}`);
  const inspected = await inspectPublicationPackage(packageDir);
  assert.equal(inspected.ok, true);
  secrets.push(pinned.capability);
  const release = { name, packageDir, releaseId: pinned.releaseId, revision: inspected.revision,
    releaseSha256: inspected.releaseSha256, packageSha256: inspected.packageSha256, capability: pinned.capability };
  releases.set(release.releaseId, release);
  step("built", { name, revision: release.revision });
  return release;
}
const candidateOf = (r) => ({ packageDir: r.packageDir, releaseId: r.releaseId, revision: r.revision,
  releaseSha256: r.releaseSha256, packageSha256: r.packageSha256 });
const portFor = (r) => createWranglerReleasePort({ candidate: candidateOf(r), wranglerPath: WRANGLER, apiToken: cloudflareToken,
  target: { kind: "staging", accountId: ACCOUNT_ID, workersSubdomain: SUBDOMAIN, supabaseUrl: STAGING_URL,
    publishableKey: STAGING_PUBLISHABLE, publicationCapability: r.capability } });
const claimFor = async (r) => {
  const claim = await queue.claim(900, 0);
  assert.ok(claim, "nothing pending to claim");
  secrets.push(claim.token);
  assert.equal(claim.revision, r.revision);
  return claim;
};

// ---- First real deployment of the Worker (Wrangler needs one before versions can be listed). ----
function bootstrapDeploy(r) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ayprom-staging-bootstrap-"));
  try {
    const config = { name: WORKER, account_id: ACCOUNT_ID, main: path.join(r.packageDir, "worker.js"),
      compatibility_date: "2026-09-19", compatibility_flags: ["nodejs_compat"], workers_dev: true, preview_urls: true,
      send_metrics: false, vars: { SUPABASE_URL: STAGING_URL, SUPABASE_PUBLISHABLE_KEY: STAGING_PUBLISHABLE, PUBLICATION_ID: r.releaseId },
      assets: { directory: path.join(r.packageDir, "site"), binding: "ASSETS", html_handling: "drop-trailing-slash",
        not_found_handling: "404-page", run_worker_first: ["/api/*", "/product/*"] } };
    writeFileSync(path.join(dir, "wrangler.json"), JSON.stringify(config), { mode: 0o600 });
    writeFileSync(path.join(dir, "bindings.json"), JSON.stringify({ PUBLICATION_CAPABILITY: r.capability }), { mode: 0o600 });
    const env = { CLOUDFLARE_API_TOKEN: cloudflareToken, WRANGLER_SEND_METRICS: "false", CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
      CI: "true", NO_COLOR: "1", WRANGLER_LOG_PATH: path.join(dir, "wrangler.log") };
    for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"]) if (process.env[name]) env[name] = process.env[name];
    try {
      execFileSync(process.execPath, [WRANGLER, "deploy", "--config", path.join(dir, "wrangler.json"), "--no-bundle",
        "--secrets-file", path.join(dir, "bindings.json"), "--message", "ayprom staging bootstrap"],
      { cwd: dir, env, windowsHide: true, timeout: 180_000, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) { throw new Error("bootstrap deploy failed: " + hide(String(error.stderr ?? error.message)).slice(-600)); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---- Latency from this machine to the real Cloudflare address. ----
async function latency(origin, names) {
  const result = {};
  for (const target of ["/", "/catalog", PRODUCT_PATH, ...names]) {
    const times = [];
    await fetch(origin + target);
    for (let i = 0; i < 30; i += 1) {
      const started = performance.now();
      const response = await fetch(origin + target);
      await response.arrayBuffer();
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    result[decodeURIComponent(target).slice(0, 48)] = { p50: Math.round(times[15]), p95: Math.round(times[28]), max: Math.round(times[29]) };
  }
  return result;
}

const summary = { ok: false, productionReady: false, remoteCloudflareStagingOnly: true };
try {
  // Baseline P0.
  step("baseline");
  const baseline = await buildRelease(`${ORIGINAL} (staging A)`);
  const baselineClaim = await claimFor(baseline);
  bootstrapDeploy(baseline);
  const basePort = portFor(baseline);
  await until(async () => (await basePort.currentDeployment()).deploymentId, "first deployment");
  const baseDeployment = await basePort.currentDeployment();
  await until(() => show(LIVE, baseline.name), "baseline visible on workers.dev", 90_000);
  const previousPointer = await control.current();
  assert.equal(await control.markReady({ releaseId: baseline.releaseId, revision: baseline.revision, releaseSha256: baseline.releaseSha256, leaseToken: baselineClaim.token }), true);
  assert.equal(await control.compareAndSet(previousPointer?.releaseId ?? null, baseline.releaseId), true);
  assert.equal(await queue.confirm(baselineClaim.token, baseline.revision, "cf:" + baseDeployment.deploymentId), true);
  assert.equal(await pointerName(), baseline.name);
  await browserCheck(LIVE, baseline.name);
  summary.baseline = { revision: baseline.revision };

  const makeProbe = (failLiveFor) => ({
    async preview(target) {
      const release = releases.get(target.releaseId);
      assert.ok(release && release.releaseSha256 === target.releaseSha256 && release.revision === target.revision);
      await until(() => show(target.url, release.name), "preview shows candidate", 90_000);
      assert.equal(await hidden(LIVE, release.name), true, "domain must not show candidate yet");
      assert.notEqual(await pointerName(), release.name, "pointer must not show candidate yet");
      return true;
    },
    async live(target) {
      try {
        const release = releases.get(target.release.releaseId);
        if (!release || release.releaseId === failLiveFor) return false;
        if ((await pointerName()) !== release.name) return false;
        await until(() => show(LIVE, release.name), "live shows release", 90_000);
        return true;
      } catch { return false; }
    },
  });
  const journalFor = (label) => {
    mkdirSync(path.join(ROOT, "dist/release-journals"), { recursive: true });
    return createReleaseJournal({ path: path.join(ROOT, "dist/release-journals", `staging-drill-${Date.now().toString(36)}-${label}.jsonl`) });
  };

  // Scenario 1: normal release P1.
  step("success-release");
  const next = await buildRelease(`${ORIGINAL} (staging B)`);
  const nextClaim = await claimFor(next);
  const outcome1 = await publishCandidate({ candidate: candidateOf(next), claim: nextClaim, cloudflare: portFor(next), control, queue,
    probe: makeProbe(null), journal: journalFor("success"), inspectPackage: inspectPublicationPackage });
  assert.equal(outcome1.status, "published");
  assert.equal(await pointerName(), next.name);
  await until(() => show(LIVE, next.name), "published release visible");
  await browserCheck(LIVE, next.name);
  summary.release = outcome1.status;

  // Scenario 2: the new release fails its live check -> real rollback to B.
  step("rollback-drill");
  const failing = await buildRelease(`${ORIGINAL} (staging C)`);
  const failingClaim = await claimFor(failing);
  const outcome2 = await publishCandidate({ candidate: candidateOf(failing), claim: failingClaim, cloudflare: portFor(failing), control, queue,
    probe: makeProbe(failing.releaseId), journal: journalFor("rollback"), inspectPackage: inspectPublicationPackage });
  assert.equal(outcome2.status, "failed_old_live");
  assert.equal(await pointerName(), next.name);
  await until(() => show(LIVE, next.name), "rolled back release visible");
  assert.equal(await hidden(LIVE, failing.name), true);
  await browserCheck(LIVE, next.name);
  summary.rollback = outcome2.status;

  step("latency");
  summary.latencyMs = await latency(LIVE, [`/api/catalog/search?q=${encodeURIComponent("насос")}`]);
  summary.ok = true;
} catch (error) {
  summary.error = hide(error?.message ?? error).slice(0, 700);
  process.exitCode = 1;
} finally {
  try { await rename(ORIGINAL); } catch { /* staging copy only */ }
  await browserInstance?.close();
}
summary.builds = builds;
console.log(hide(JSON.stringify(summary)));
