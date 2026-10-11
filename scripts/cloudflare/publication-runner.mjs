// Publishes the current catalog to the public Cloudflare site (the "publication worker"). Runs in GitHub
// Actions, started by the admin after edits, or by hand. One run: wait for the quiet period after the last
// edit, build a snapshot of the catalog, verify it on a private preview address, switch the site to it, verify
// the live site, and roll back automatically if the live check fails. Repeats while newer edits keep arriving.
// STAGING ONLY for now: the target is fixed by environment variables and must be the staging project.
// Secrets come from the environment and are never printed.
// Usage: node scripts/cloudflare/publication-runner.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectPublicationPackage } from "./publication-package-inspector.mjs";
import { runWorkersBuildEntry } from "./workers-build-runner-lib.mjs";
import { adoptionPlan, currentDeployment } from "./publication-reconcile.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const need = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
};

const SUPABASE_URL = need("SUPABASE_URL");
const PUBLISHABLE_KEY = need("SUPABASE_PUBLISHABLE_KEY");
const SECRET_KEY = need("SUPABASE_SECRET_KEY");
const CLOUDFLARE_TOKEN = need("CLOUDFLARE_API_TOKEN");
const ACCOUNT_ID = need("CLOUDFLARE_ACCOUNT_ID");
const SUBDOMAIN = need("WORKERS_SUBDOMAIN");
const WORKER = need("WORKER_NAME");
const WRANGLER = process.env.WRANGLER_PATH?.trim() || path.join(ROOT, "node_modules/wrangler/bin/wrangler.js");
const DEBOUNCE_SECONDS = Number(process.env.PUBLICATION_DEBOUNCE_SECONDS ?? 45);
const WAIT_FOR_QUIET_MS = Number(process.env.PUBLICATION_WAIT_MS ?? 6 * 60_000);
const MAX_RELEASES = Number(process.env.PUBLICATION_MAX_RELEASES ?? 3);
const LIVE = `https://${WORKER}.${SUBDOMAIN}.workers.dev`;

// Guard: this runner publishes only to the staging project until the production steps are approved.
assert.ok(process.env.PUBLICATION_TARGET === "staging", "PUBLICATION_TARGET must be staging");
assert.ok(new URL(SUPABASE_URL).hostname === "jpmoxtqafgbqihvjhvri.supabase.co", "staging project only");

const secrets = [CLOUDFLARE_TOKEN, SECRET_KEY];
const hide = (value) => secrets.reduce((text, secret) => text.replaceAll(secret, "[hidden]"), String(value));
const log = (event, extra = {}) => process.stderr.write(hide(JSON.stringify({ event, ...extra })) + "\n");

register(pathToFileURL(path.join(ROOT, "scripts/cloudflare/static-producer-loader.mjs")).href,
  { parentURL: import.meta.url, data: { srcRoot: path.join(ROOT, "src") } });
const load = (relative) => import(pathToFileURL(path.join(ROOT, "src/cloudflare", relative)).href);
const [{ createPublicationControlClient }, { createPublicationQueueClient }, { createReleaseJournal },
  { publishCandidate }, { createWranglerReleasePort }] = await Promise.all([
  load("publication/publication-control.ts"), load("static-build/producer/publication-queue.ts"),
  load("publication/release-journal.ts"), load("publication/release-coordinator.ts"),
  load("publication/wrangler-inactive-port.ts")]);
const bindings = { SUPABASE_URL, PUBLICATION_SUPABASE_KEY: SECRET_KEY };
const control = createPublicationControlClient(bindings);
const queue = createPublicationQueueClient(bindings);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const restHeaders = { apikey: SECRET_KEY, authorization: `Bearer ${SECRET_KEY}` };
const rest = async (pathAndQuery) => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: restHeaders, signal: AbortSignal.timeout(20_000) });
  assert.ok(response.ok, `read failed ${response.status}`);
  return response.json();
};
const publicRpc = async (name, body) => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: "POST", signal: AbortSignal.timeout(15_000),
    headers: { apikey: PUBLISHABLE_KEY, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  return response.json();
};

// Is there anything newer than the published site?
async function pending() {
  const [revision] = await rest("content_revision?select=current_revision&singleton=eq.true");
  const [job] = await rest("publication_jobs?select=deployed_revision&singleton=eq.true");
  return Number(revision?.current_revision ?? 0) > Number(job?.deployed_revision ?? 0);
}

// Deployments of the Worker as Cloudflare reports them (newest versions included).
function listDeployments() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ayprom-deployments-"));
  try {
    writeFileSync(path.join(dir, "wrangler.json"), JSON.stringify({ name: WORKER, account_id: ACCOUNT_ID, compatibility_date: "2026-09-19" }));
    const env = { CLOUDFLARE_API_TOKEN: CLOUDFLARE_TOKEN, WRANGLER_SEND_METRICS: "false", CI: "true", NO_COLOR: "1", WRANGLER_LOG_PATH: path.join(dir, "wrangler.log") };
    for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"]) if (process.env[name]) env[name] = process.env[name];
    const output = execFileSync(process.execPath, [WRANGLER, "deployments", "list", "--config", path.join(dir, "wrangler.json"), "--json"],
      { cwd: dir, env, windowsHide: true, timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(String(output).slice(String(output).indexOf("[")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// After a rollback Cloudflare serves the same version under a NEW deployment id while the database still
// remembers the old id; the release coordinator refuses to continue on such a mismatch. If the version and the
// revision agree, the remembered id is updated (only if it still has the value we read); anything else is left
// for a person.
async function reconcileRemembered() {
  const deployments = listDeployments();
  const [job] = await rest("publication_jobs?select=deployed_revision,deployment_identifier&singleton=eq.true");
  const pointer = await control.current();
  const plan = adoptionPlan({
    queue: { deployedRevision: Number(job?.deployed_revision ?? 0), deploymentIdentifier: job?.deployment_identifier ?? null },
    pointerRevision: pointer?.revision ?? 0, hosting: currentDeployment(deployments), deployments });
  if (!plan.adopt) return log("reconcile", { adopted: false, reason: plan.reason });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/publication_jobs?singleton=eq.true&deployed_revision=eq.${plan.revision}&deployment_identifier=eq.${encodeURIComponent(plan.from)}`, {
    method: "PATCH", signal: AbortSignal.timeout(20_000),
    headers: { ...restHeaders, "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({ deployment_identifier: plan.to }) });
  const rows = response.ok ? await response.json() : [];
  log("reconcile", { adopted: rows.length === 1, revision: plan.revision });
}

// Wait for the quiet period after the last edit; null when there is nothing (left) to publish.
async function claimWhenQuiet() {
  const deadline = Date.now() + WAIT_FOR_QUIET_MS;
  for (;;) {
    const claim = await queue.claim(1200, DEBOUNCE_SECONDS);
    if (claim) return claim;
    if (!(await pending()) || Date.now() > deadline) return null;
    await sleep(10_000);
  }
}

// A real product the build can use to prove the snapshot works end to end (page, search, browser).
async function pickProbeProduct() {
  const categories = new Map((await rest("categories?select=slug,type")).map((row) => [row.slug, row.type]));
  const products = await rest("products?select=slug,name,category_slug,subcategory_id&published=eq.true&order=slug&limit=300");
  const sample = products.find((product) => !product.subcategory_id && categories.get(product.category_slug) !== "brand");
  assert.ok(sample, "no suitable published product for the build check");
  return sample;
}

const show = async (origin, product) => {
  const page = await fetch(`${origin}/catalog/category/${product.category_slug}/${product.slug}`, { signal: AbortSignal.timeout(20_000) });
  const search = await fetch(`${origin}/api/catalog/search?q=${encodeURIComponent(product.name)}`, { signal: AbortSignal.timeout(20_000) });
  if (page.status !== 200 || search.status !== 200) return false;
  const items = (await search.json()).items ?? [];
  return (await page.text()).includes(product.name) && items.some((item) => item.slug === product.slug);
};
async function until(check, label, timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if (await check()) return; } catch { /* retry */ }
    await sleep(2000);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function releaseOnce() {
  const claim = await claimWhenQuiet();
  if (!claim) return "nothing";
  secrets.push(claim.token);
  log("claimed", { revision: claim.revision });
  // A fresh checkout has no dist folder; the build's path safety check requires the package area to exist.
  mkdirSync(path.join(ROOT, "dist/worker-packages"), { recursive: true });
  const packageDir = path.join(ROOT, "dist/worker-packages", `publication-${claim.revision}-${Date.now().toString(36)}`);
  try {
    const product = await pickProbeProduct();
    const { outcome, pinned } = await runWorkersBuildEntry({
      env: { ...process.env, AYPROM_WORKERS_BUILD_MODE: "workers-build", AYPROM_WORKERS_BUILD_SUPABASE_URL: SUPABASE_URL,
        AYPROM_WORKERS_BUILD_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY, AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST: SUPABASE_URL,
        ADMIN_SUPABASE_KEY: SECRET_KEY },
      argv: ["--staging-pinned", "--published", path.join(ROOT, "dist/worker-packages/previous-absent"), "--package", packageDir],
      probe: { query: product.name, expectedName: product.name, slug: product.slug, categorySlug: product.category_slug } });
    if (!outcome.ok) throw new Error(`build failed: ${outcome.code}/${outcome.stage}`);
    const inspected = await inspectPublicationPackage(packageDir);
    assert.equal(inspected.ok, true, "package inspection failed");
    secrets.push(pinned.capability);
    assert.equal(inspected.revision, claim.revision, "built revision differs from the claimed one");
    log("built", { revision: inspected.revision });
    await queue.renew(claim.token, claim.revision, 1200);

    const candidate = { packageDir, releaseId: pinned.releaseId, revision: inspected.revision,
      releaseSha256: inspected.releaseSha256, packageSha256: inspected.packageSha256 };
    const cloudflare = createWranglerReleasePort({ candidate, wranglerPath: WRANGLER, apiToken: CLOUDFLARE_TOKEN,
      target: { kind: "staging", accountId: ACCOUNT_ID, workersSubdomain: SUBDOMAIN, supabaseUrl: SUPABASE_URL,
        publishableKey: PUBLISHABLE_KEY, publicationCapability: pinned.capability } });
    mkdirSync(path.join(ROOT, "dist/release-journals"), { recursive: true });
    const journal = createReleaseJournal({ path: path.join(ROOT, "dist/release-journals", `publication-${claim.revision}.jsonl`) });
    const pointerName = async () => (await publicRpc("read_catalog_publication_document", { kind: "product", key: product.slug }))?.name;
    const probe = {
      async preview(target) {
        assert.ok(target.releaseId === candidate.releaseId && target.releaseSha256 === candidate.releaseSha256);
        await until(() => show(target.url, product), "preview shows the product");
        return true;
      },
      async live() {
        try {
          if ((await pointerName()) !== product.name) return false;
          await until(() => show(LIVE, product), "live shows the product");
          return true;
        } catch { return false; }
      },
    };
    // What the coordinator is about to compare, so a refusal can be understood from the log alone.
    const peek = async (label, read) => { try { return await read(); } catch (error) { return { [label + "Error"]: hide(error?.message ?? error).slice(0, 120) }; } };
    log("state", {
      pointer: await peek("pointer", () => control.current()),
      hosting: await peek("hosting", () => cloudflare.currentDeployment()),
      queue: await peek("queue", () => queue.state(claim.token)),
    });
    const result = await publishCandidate({ candidate, claim, cloudflare, control, queue, probe, journal, inspectPackage: inspectPublicationPackage });
    log("result", { status: result.status });
    if (result.status !== "published") {
      // The journal lists each release step and the reason a step failed, so a refusal can be understood from the log.
      try {
        const lines = readFileSync(path.join(ROOT, "dist/release-journals", `publication-${claim.revision}.jsonl`), "utf8").trim().split("\n");
        log("journal", { lines: lines.slice(-12).map((line) => hide(line).slice(0, 300)) });
      } catch { /* no journal to show */ }
    }
    return result.status;
  } catch (error) {
    log("failed", { message: hide(error?.message ?? error).slice(0, 300) });
    await queue.fail(claim.token, "build_failed").catch(() => undefined);
    throw error;
  }
}

await reconcileRemembered();
let published = 0;
for (let round = 0; round < MAX_RELEASES; round += 1) {
  const status = await releaseOnce();
  if (status === "nothing") break;
  if (status !== "published") process.exitCode = 1;
  if (status !== "published") break;
  published += 1;
  if (!(await pending())) break;
}
log("done", { published });
