// Publishes the current catalog to the public Cloudflare site (the "publication worker"). Runs in GitHub
// Actions, started by the admin after edits, or by hand. One run: wait for the quiet period after the last
// edit, build a snapshot of the catalog, verify it on a private preview address, switch the site to it, verify
// the live site, and roll back automatically if the live check fails. Repeats while newer edits keep arriving.
// The target (staging or production) comes from environment variables and is checked by publication-targets.mjs.
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
import { resolvePublicationTarget } from "./publication-targets.mjs";
import { requestRebuild } from "./publication-rebuild.mjs";

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

// Interlock: the database, the Worker and the target name must belong together (staging data only to the staging
// Worker, production only to the production Worker, and production only with its explicit confirmation).
const TARGET = resolvePublicationTarget(process.env);

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

const pointerNameOf = async (product) => (await publicRpc("read_catalog_publication_document", { kind: "product", key: product.slug }))?.name;

// Does the Worker exist yet? Only Cloudflare's "not found" answer (10007) means no; any other failure stops the run.
async function workerExists() {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER}/settings`, {
    headers: { authorization: `Bearer ${CLOUDFLARE_TOKEN}` }, signal: AbortSignal.timeout(20_000) });
  const answer = await response.json().catch(() => ({}));
  if (answer.success === true) return true;
  if (answer.errors?.some((error) => error.code === 10007)) return false;
  throw new Error(`could not check whether the Worker exists (status ${response.status})`);
}

// The very first release of a Worker: `versions upload` cannot create a Worker, so the built snapshot itself becomes its
// first deployment (workers.dev and preview addresses on), and only then are the database pointer and the queue updated.
// Refused when a pointer already exists: a Worker that is gone while the database remembers a release needs a person.
async function firstRelease({ claim, candidate, pinned, product }) {
  const previous = await control.current();
  assert.ok(!previous?.releaseId, "the Worker does not exist but the database already points at a release: needs a person");
  log("first_release", { worker: WORKER, revision: candidate.revision });
  const dir = mkdtempSync(path.join(os.tmpdir(), "ayprom-first-release-"));
  try {
    const config = { name: WORKER, account_id: ACCOUNT_ID, main: path.join(candidate.packageDir, "worker.js"),
      compatibility_date: "2026-09-19", compatibility_flags: ["nodejs_compat"], workers_dev: true, preview_urls: true, send_metrics: false,
      vars: { SUPABASE_URL: TARGET.supabaseOrigin, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY, PUBLICATION_ID: candidate.releaseId },
      assets: { directory: path.join(candidate.packageDir, "site"), binding: "ASSETS", html_handling: "drop-trailing-slash",
        not_found_handling: "404-page", run_worker_first: ["/api/*", "/product/*"] } };
    writeFileSync(path.join(dir, "wrangler.json"), JSON.stringify(config), { mode: 0o600 });
    writeFileSync(path.join(dir, "bindings.json"), JSON.stringify({ PUBLICATION_CAPABILITY: pinned.capability }), { mode: 0o600 });
    const env = { CLOUDFLARE_API_TOKEN: CLOUDFLARE_TOKEN, WRANGLER_SEND_METRICS: "false", CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
      CI: "true", NO_COLOR: "1", WRANGLER_LOG_PATH: path.join(dir, "wrangler.log") };
    for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"]) if (process.env[name]) env[name] = process.env[name];
    try {
      execFileSync(process.execPath, [WRANGLER, "deploy", "--config", path.join(dir, "wrangler.json"), "--no-bundle",
        "--secrets-file", path.join(dir, "bindings.json"), "--message", `ayprom first release (${TARGET.name})`],
      { cwd: dir, env, windowsHide: true, timeout: 180_000, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) { throw new Error("first deploy failed: " + hide(String(error.stderr ?? error.message)).slice(-600)); }
  } finally { rmSync(dir, { recursive: true, force: true }); }

  await until(() => show(LIVE, product), "the first release is visible on the Worker address", 120_000);
  const deployment = currentDeployment(listDeployments());
  assert.ok(deployment, "no single-version deployment after the first deploy");
  assert.equal(await control.markReady({ releaseId: candidate.releaseId, revision: candidate.revision,
    releaseSha256: candidate.releaseSha256, leaseToken: claim.token }), true, "could not mark the release ready");
  assert.equal(await control.compareAndSet(null, candidate.releaseId), true, "could not move the database pointer");
  assert.equal(await queue.confirm(claim.token, candidate.revision, `cf:${deployment.deploymentId}`), true, "could not confirm the publication");
  assert.equal(await pointerNameOf(product), product.name, "the pointer does not show the product");
  log("first_release_done", { revision: candidate.revision });
  return "published";
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
    if (!(await workerExists())) {
      const first = { packageDir, releaseId: pinned.releaseId, revision: inspected.revision, releaseSha256: inspected.releaseSha256, packageSha256: inspected.packageSha256 };
      return await firstRelease({ claim, candidate: first, pinned, product });
    }

    const candidate = { packageDir, releaseId: pinned.releaseId, revision: inspected.revision,
      releaseSha256: inspected.releaseSha256, packageSha256: inspected.packageSha256 };
    const cloudflare = createWranglerReleasePort({ candidate, wranglerPath: WRANGLER, apiToken: CLOUDFLARE_TOKEN,
      target: { kind: TARGET.name, workerName: TARGET.workerName, accountId: ACCOUNT_ID, workersSubdomain: SUBDOMAIN, supabaseUrl: SUPABASE_URL,
        publishableKey: PUBLISHABLE_KEY, publicationCapability: pinned.capability } });
    mkdirSync(path.join(ROOT, "dist/release-journals"), { recursive: true });
    const journal = createReleaseJournal({ path: path.join(ROOT, "dist/release-journals", `publication-${claim.revision}.jsonl`) });
    const pointerName = () => pointerNameOf(product);
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
        log("journal", { steps: lines.slice(-14).map((line) => { try { const row = JSON.parse(line); return row.reasonCode ? `${row.status}:${row.reasonCode}` : String(row.status); } catch { return hide(line).slice(0, 80); } }) });
      } catch { /* no journal to show */ }
    }
    return result.status;
  } catch (error) {
    log("failed", { message: hide(error?.message ?? error).slice(0, 300) });
    await queue.fail(claim.token, "build_failed").catch(() => undefined);
    throw error;
  }
}

// PUBLICATION_DRY_RUN=yes: check every setting and read the current state, publish nothing, claim nothing.
async function dryRun() {
  const [revision] = await rest("content_revision?select=current_revision&singleton=eq.true");
  const [job] = await rest("publication_jobs?select=deployed_revision&singleton=eq.true");
  const exists = await workerExists();
  const product = await pickProbeProduct();
  const pointer = await control.current();
  const contentRevision = Number(revision?.current_revision ?? 0);
  const deployedRevision = Number(job?.deployed_revision ?? 0);
  log("dry_run", { target: TARGET.name, worker: WORKER, workerExists: exists, contentRevision, deployedRevision,
    pendingPublication: contentRevision > deployedRevision, hasPointer: Boolean(pointer?.releaseId),
    firstReleaseNeeded: !exists, probeProduct: product.slug });
}
if (process.env.PUBLICATION_DRY_RUN === "yes") {
  await dryRun();
  process.exit(0);
}

if (await workerExists()) await reconcileRemembered();
else log("reconcile", { skipped: "the Worker does not exist yet" });
// After a change of the site's code nothing in the content is newer, so ask for a publication explicitly.
if (process.env.PUBLICATION_FORCE_REBUILD === "yes" && !(await pending())) log("force_rebuild", await requestRebuild({ supabaseUrl: SUPABASE_URL, secretKey: SECRET_KEY }));
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
