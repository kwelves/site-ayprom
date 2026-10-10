import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startPackagedWorker } from "./package-worker-assets-lib.mjs";
import { probePinnedCatalogBrowser } from "./pinned-catalog-browser-probe.mjs";
import { inspectPublicationPackage } from "./publication-package-inspector.mjs";
import { runWorkersBuildEntry } from "./workers-build-runner-lib.mjs";

// Joint local drill: REAL isolated database, REAL pinned Next builds and packages, REAL
// workerd for each package, REAL Chromium. The ONLY simulated part is Cloudflare's version
// switch: a loopback reverse proxy stands in for "which version serves the domain".
// It proves our coordinator logic with real artifacts, not remote provider behaviour.
const SLUG = "capture-http-product";
const PRODUCT_PATH = "/catalog/category/capture-http/capture-http-product";
const text = (value) => String(value);

export async function runLocalReleaseDrill({ apiUrl, publicKey, privateKey, projectId, localSql, root }) {
  assert.equal(apiUrl, "http://127.0.0.1:56421");
  assert.match(projectId, /^ayprom-catalog-[a-f0-9]{10}$/);
  register("./static-producer-loader.mjs", { parentURL: import.meta.url, data: { srcRoot: path.join(root, "src") } });
  const load = (relative) => import(pathToFileURL(path.join(root, "src/cloudflare", relative)).href);
  const [{ createPublicationControlClient }, { createPublicationQueueClient }, { createReleaseJournal },
    { publishCandidate }] = await Promise.all([load("publication/publication-control.ts"),
    load("static-build/producer/publication-queue.ts"), load("publication/release-journal.ts"),
    load("publication/release-coordinator.ts")]);

  const quote = (value) => text(value).replaceAll("'", "''");
  const secrets = [privateKey];
  let httpChecks = 0;
  const fetcher = async (url, init) => {
    assert.equal(new URL(url).origin, apiUrl);
    httpChecks += 1;
    const response = await fetch(url, init);
    const body = await response.clone().text();
    for (const secret of secrets) assert.ok(!body.includes(secret), "drill response leaked credential");
    return response;
  };
  const bindings = { SUPABASE_URL: apiUrl, PUBLICATION_SUPABASE_KEY: privateKey };
  const control = createPublicationControlClient(bindings, fetcher);
  const queue = createPublicationQueueClient(bindings, fetcher);
  const publicHeaders = { apikey: publicKey, "content-type": "application/json" };
  if (publicKey.startsWith("eyJ")) publicHeaders.authorization = `Bearer ${publicKey}`;

  const previousJob = localSql("select coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) from public.publication_jobs j;").trim();
  const previousPointer = localSql("select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from catalog_private.catalog_publication_active a;").trim();
  const originalName = JSON.parse(localSql("select to_jsonb(name) from public.products where slug='capture-http-product';").trim());
  assert.equal(typeof originalName, "string");

  // Release-by-identity expectations. A release is identified only through its server-held
  // capability; the capability stays in this Node process and the local workerd command line.
  const releases = new Map();
  const readProduct = async (release) => {
    const body = { kind: "product", key: SLUG,
      ...(release ? { publication_id: release.releaseId, publication_capability: release.capability } : {}) };
    const response = await fetcher(new URL("/rest/v1/rpc/read_catalog_publication_document", apiUrl), {
      method: "POST", headers: publicHeaders, body: JSON.stringify(body), redirect: "error",
      signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200);
    return response.json();
  };

  // ---- Simulated Cloudflare edge: a proxy to whichever local workerd is "active". ----
  const edge = { target: null, requests: 0 };
  const proxy = createServer((req, res) => {
    edge.requests += 1;
    if (!edge.target) { res.writeHead(503).end(); return; }
    const upstream = new URL(edge.target);
    const forward = httpRequest({ host: upstream.hostname, port: upstream.port, path: req.url, method: req.method,
      headers: { ...req.headers, host: upstream.host }, agent: false }, (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    });
    forward.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(forward);
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const front = `http://127.0.0.1:${proxy.address().port}`;

  const versions = new Map();
  let deploymentCounter = 0;
  let active = null;
  let afterActivation = null;
  const cloudflare = {
    async currentDeployment() { return { deploymentId: active.deploymentId, versionId: active.versionId }; },
    async uploadInactive(packageDir) {
      const release = [...releases.values()].find((item) => item.packageDir === packageDir);
      assert.ok(release, "unknown package");
      const worker = await startPackagedWorker({ packageDir, supabaseUrl: apiUrl, publishableKey: publicKey,
        publicationId: release.releaseId, publicationCapability: release.capability,
        publicationSha256: release.releaseSha256, requireRelease: true });
      const versionId = "drill-v-" + (versions.size + 1);
      versions.set(versionId, { worker, release });
      return { versionId };
    },
    async preview(versionId) {
      assert.ok(versions.has(versionId));
      return { url: `https://drill-preview.invalid/${versionId}` };
    },
    async activate(versionId) {
      const version = versions.get(versionId);
      assert.ok(version);
      deploymentCounter += 1;
      active = { versionId, deploymentId: "drill-dep-" + deploymentCounter, release: version.release.releaseId };
      edge.target = version.worker.baseUrl;
      if (afterActivation) await afterActivation(versionId);
      return { deploymentId: active.deploymentId };
    },
    async rollback(versionId) {
      const version = versions.get(versionId);
      assert.ok(version);
      deploymentCounter += 1;
      active = { versionId, deploymentId: "drill-dep-" + deploymentCounter, release: version.release.releaseId };
      edge.target = version.worker.baseUrl;
      return { deploymentId: active.deploymentId };
    },
  };

  const pageHas = async (origin, name) => {
    const response = await fetch(origin + PRODUCT_PATH, { signal: AbortSignal.timeout(10_000) });
    return response.status === 200 && (await response.text()).includes(name);
  };
  const searchNames = async (origin, query) => {
    const response = await fetch(`${origin}/api/catalog/search?q=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(10_000) });
    if (response.status !== 200) return null;
    return (await response.json()).items.map((item) => item.name);
  };
  // One observation of what a visitor sees at an origin: page, search and (for the edge) pointer.
  const consistent = async (origin, release) => {
    const names = await searchNames(origin, release.name);
    return (await pageHas(origin, release.name)) && Array.isArray(names) && names.includes(release.name);
  };
  const browser = (origin, release) => probePinnedCatalogBrowser({ baseUrl: origin, query: release.name,
    expectedName: release.name, expectedSlug: SLUG, productPath: PRODUCT_PATH, sensitiveValue: release.capability });
  const probeRelease = (releaseId) => [...releases.values()].find((item) => item.releaseId === releaseId);
  let previewChecks = 0, liveChecks = 0;
  const probe = {
    async preview(target) {
      const version = versions.get(new URL(target.url).pathname.slice(1));
      assert.ok(version && version.release.releaseId === target.releaseId);
      assert.equal(version.release.releaseSha256, target.releaseSha256);
      assert.equal(version.release.revision, target.revision);
      const candidate = version.release, old = probeRelease(active.release);
      assert.ok(candidate && old);
      // The candidate preview shows ITS pinned snapshot ...
      assert.equal(await consistent(version.worker.baseUrl, candidate), true, "preview must show candidate snapshot");
      await browser(version.worker.baseUrl, candidate);
      // ... while the previous version keeps serving the domain and the old pointer.
      assert.equal(active.release, old.releaseId);
      assert.equal(await consistent(front, old), true, "previous version must stay reachable");
      assert.deepEqual(await searchNames(front, candidate.name), [], "domain must not show candidate yet");
      assert.equal((await readProduct()).name, old.name, "pointer must not show candidate yet");
      previewChecks += 1;
      return true;
    },
    async live(target) {
      try {
        liveChecks += 1;
        const release = probeRelease(target.release.releaseId);
        if (!release || target.deploymentId !== active.deploymentId || target.versionId !== active.versionId) return false;
        if ((await readProduct()).name !== release.name) return false;
        if (!await consistent(front, release)) return false;
        await browser(front, release);
        return true;
      } catch { return false; }
    },
  };

  // ---- Build, claim and publish helpers. ----
  const resetQueue = (revision, identifier) => localSql(`insert into public.publication_jobs(singleton) values(true) on conflict(singleton) do nothing;
    update public.publication_jobs set deployed_revision=${revision},deployment_identifier=${identifier ? "'" + quote(identifier) + "'" : "null"},
    lease_revision=null,lease_token=null,lease_until=null,attempt_revision=null,attempt_count=0,retry_after=null,last_error_code=null;`);
  const suffix = randomBytes(6).toString("hex");
  let built = 0;
  const buildRelease = async (name) => {
    localSql(`update public.products set name='${quote(name)}' where slug='${SLUG}';`);
    built += 1;
    const packageDir = path.join(root, "dist/worker-packages", `release-drill-${suffix}-${built}`);
    const { outcome, pinned } = await runWorkersBuildEntry({
      env: { ...process.env, AYPROM_WORKERS_BUILD_MODE: "loopback-fixture", AYPROM_WORKERS_BUILD_SUPABASE_URL: apiUrl,
        AYPROM_WORKERS_BUILD_SUPABASE_PUBLISHABLE_KEY: publicKey, ADMIN_SUPABASE_KEY: privateKey },
      argv: ["--local-pinned", "--published", path.join(root, "dist/worker-packages/pinned-local-previous-absent"),
        "--package", packageDir],
      probe: { query: name, expectedName: name } });
    assert.equal(outcome.ok, true, "real pinned build must pass");
    assert.ok(pinned);
    const inspected = await inspectPublicationPackage(packageDir);
    assert.equal(inspected.ok, true);
    assert.equal(inspected.releaseId, pinned.releaseId);
    assert.equal(inspected.releaseSha256, pinned.publicationSha256);
    secrets.push(pinned.capability);
    const release = { name, packageDir, releaseId: pinned.releaseId, revision: inspected.revision,
      releaseSha256: inspected.releaseSha256, packageSha256: inspected.packageSha256, capability: pinned.capability };
    releases.set(release.releaseId, release);
    return release;
  };
  const claimFor = async (release) => {
    const claim = await queue.claim(900, 0);
    assert.ok(claim);
    secrets.push(claim.token);
    assert.equal(claim.revision, release.revision, "claim must be for the built revision");
    return claim;
  };
  const journalFor = (label) => {
    mkdirSync(path.join(root, "dist/release-journals"), { recursive: true });
    const journalPath = path.join(root, "dist/release-journals", `release-drill-${suffix}-${label}.jsonl`);
    return { journalPath, journal: createReleaseJournal({ path: journalPath }) };
  };
  const candidateOf = (release) => ({ packageDir: release.packageDir, releaseId: release.releaseId,
    revision: release.revision, releaseSha256: release.releaseSha256, packageSha256: release.packageSha256 });

  const results = [];
  let stepName = "start";
  const step = (name) => { stepName = name; process.stderr.write(JSON.stringify({ drillStep: name }) + "\n"); };
  try {
    // ---- Baseline: a previously confirmed release served by the edge. ----
    step("baseline");
    resetQueue(0, null);
    const baseline = await buildRelease("Drill alpha edition");
    const baselineClaim = await claimFor(baseline);
    const baselineWorker = await startPackagedWorker({ packageDir: baseline.packageDir, supabaseUrl: apiUrl,
      publishableKey: publicKey, publicationId: baseline.releaseId, publicationCapability: baseline.capability,
      publicationSha256: baseline.releaseSha256, requireRelease: true });
    versions.set("drill-v-0", { worker: baselineWorker, release: baseline });
    assert.equal(await control.markReady({ releaseId: baseline.releaseId, revision: baseline.revision,
      releaseSha256: baseline.releaseSha256, leaseToken: baselineClaim.token }), true);
    assert.equal(await control.compareAndSet((await control.current())?.releaseId ?? null, baseline.releaseId), true);
    assert.equal(await queue.confirm(baselineClaim.token, baseline.revision, "cf:drill-dep-0"), true);
    active = { versionId: "drill-v-0", deploymentId: "drill-dep-0", release: baseline.releaseId };
    edge.target = baselineWorker.baseUrl;
    assert.equal(await consistent(front, baseline), true);
    await browser(front, baseline);
    assert.equal((await readProduct()).name, baseline.name);

    // ---- Scenario 1: normal publication. ----
    step("success-scenario");
    const success = await buildRelease("Drill beta edition");
    assert.ok(success.revision > baseline.revision);
    const successRun = journalFor("success");
    const successClaim = await claimFor(success);
    const outcome1 = await publishCandidate({ candidate: candidateOf(success), claim: successClaim,
      cloudflare, control, queue, probe, journal: successRun.journal, inspectPackage: inspectPublicationPackage });
    assert.equal(outcome1.status, "published");
    assert.equal(outcome1.productionReady, false);
    assert.equal(versions.get(active.versionId).release.releaseId, success.releaseId, "edge serves the new package");
    assert.equal(await consistent(front, success), true, "page, search and pointer after release");
    await browser(front, success);
    assert.equal((await readProduct()).name, success.name);
    assert.equal((await queue.state(successClaim.token)).deployedRevision, success.revision);
    results.push(outcome1.status);

    // ---- Scenario 2: the new version dies after activation; restore the confirmed release. ----
    step("failure-scenario");
    const failing = await buildRelease("Drill gamma edition");
    const failureRun = journalFor("failure");
    const failureClaim = await claimFor(failing);
    afterActivation = async (versionId) => { await versions.get(versionId).worker.stop(); };
    const outcome2 = await publishCandidate({ candidate: candidateOf(failing), claim: failureClaim,
      cloudflare, control, queue, probe, journal: failureRun.journal, inspectPackage: inspectPublicationPackage });
    afterActivation = null;
    assert.equal(outcome2.status, "failed_old_live");
    assert.equal(outcome2.productionReady, false);
    assert.equal(active.release, success.releaseId, "edge returned to the previously confirmed release");
    assert.equal(await consistent(front, success), true);
    await browser(front, success);
    assert.equal((await readProduct()).name, success.name);
    assert.deepEqual(await searchNames(front, failing.name), [], "failed candidate must not be visible");
    assert.equal((await queue.state(failureClaim.token)).deployedRevision, success.revision);
    results.push(outcome2.status);

    // ---- Retention: nothing is deleted by success or recovery. ----
    step("retention");
    for (const release of releases.values()) {
      assert.equal(existsSync(path.join(release.packageDir, "package-manifest.json")), true, "package retained");
      assert.equal((await readProduct(release)).name, release.name, "snapshot retained and readable by its own right");
    }
    const ids = [...releases.keys()].map((id) => "'" + id + "'").join(",");
    assert.equal(localSql(`select count(*) from catalog_private.catalog_releases where id in (${ids});`).trim(), String(releases.size));

    // ---- No secret in packages, journals, or the edge's pages. ----
    const scan = (file) => {
      const stat = lstatSync(file);
      if (stat.isDirectory()) { for (const name of readdirSync(file)) scan(path.join(file, name)); return; }
      if (stat.size > 8 * 1024 * 1024) return;
      const bytes = readFileSync(file);
      for (const secret of secrets) assert.ok(!bytes.includes(secret), "secret found in retained artifact");
    };
    for (const release of releases.values()) scan(release.packageDir);
    scan(successRun.journalPath); scan(failureRun.journalPath);
    const fingerprints = secrets.map((secret) => createHash("sha256").update(secret).digest("hex").slice(0, 8));
    assert.equal(new Set(fingerprints).size, fingerprints.length);

    return { ok: true, scenarios: results, builds: built, realPackages: true, realWorkerd: true, realBrowser: true,
      realDatabase: true, simulatedCloudflareSwitch: true, remoteCloudflare: false, httpChecks, previewChecks,
      liveChecks, edgeRequests: edge.requests, retainedReleases: releases.size, productionReady: false };
  } catch (error) {
    // Fixed-shape diagnostic: step name plus the assertion text with every known secret removed.
    const message = secrets.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), String(error?.message ?? error)).slice(0, 600);
    process.stderr.write(JSON.stringify({ drillFailure: { step: stepName, message } }) + "\n");
    throw error;
  } finally {
    for (const version of versions.values()) await version.worker.stop();
    await new Promise((resolve) => proxy.close(resolve));
    localSql(`update public.products set name='${quote(originalName)}' where slug='${SLUG}';
      delete from catalog_private.catalog_publication_active;
      insert into catalog_private.catalog_publication_active select * from jsonb_populate_recordset(
        null::catalog_private.catalog_publication_active,'${quote(previousPointer)}'::jsonb);
      delete from public.publication_jobs;
      insert into public.publication_jobs select * from jsonb_populate_recordset(
        null::public.publication_jobs,'${quote(previousJob)}'::jsonb);`);
  }
}
