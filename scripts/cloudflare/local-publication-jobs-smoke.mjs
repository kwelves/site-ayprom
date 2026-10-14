// Run publication-queue pgTAP in a disposable Supabase project only.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertPortsFree, command, createIsolatedProject } from "./local-admin-auth-smoke.mjs";

const root = path.resolve(import.meta.dirname, "../..");
register("./static-producer-loader.mjs", { parentURL: import.meta.url, data: { srcRoot: path.join(root, "src") } });
const { createPublicationQueueClient } = await import(pathToFileURL(
  path.join(root, "src/cloudflare/static-build/producer/publication-queue.ts"),
).href);

async function whileLeaseExpiresUnderLock(projectId, action) {
  const blocker = spawn("docker", ["exec", "-i", `supabase_db_${projectId}`,
    "psql", "-X", "-A", "-t", "-q", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
    windowsHide: true,
  });
  const ready = new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("publication_lock_timeout")), 10_000);
    blocker.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (output.includes("PUBLICATION_LOCKED")) { clearTimeout(timer); resolve(); }
    });
    blocker.on("error", (error) => { clearTimeout(timer); reject(error); });
    blocker.on("close", () => {
      if (!output.includes("PUBLICATION_LOCKED")) { clearTimeout(timer); reject(new Error("publication_lock_failed")); }
    });
  });
  const finished = new Promise((resolve, reject) => {
    blocker.on("close", (code) => code === 0 ? resolve() : reject(new Error("publication_lock_failed")));
    blocker.on("error", reject);
  });
  blocker.stdin.end("BEGIN;\nUPDATE public.publication_jobs SET lease_until = clock_timestamp() + interval '2 seconds' WHERE singleton = true;\nSELECT 'PUBLICATION_LOCKED';\nSELECT pg_sleep(4);\nCOMMIT;\n");
  try {
    await ready;
    const result = await action();
    await finished;
    return result;
  } finally {
    if (blocker.exitCode === null) blocker.kill();
    await finished.catch(() => {});
  }
}

const prefix = "ayprom-publication-jobs-";
const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
const projectId = `ayprom-jobs-${randomBytes(5).toString("hex")}`;
let started = false;
let ok = false;

try {
  await assertPortsFree();
  createIsolatedProject(directory, projectId);
    started = true;
    command("supabase", ["start", "--workdir", directory,
      "--exclude", "studio,realtime,storage-api,imgproxy,postgres-meta,mailpit,edge-runtime,logflare,vector,supavisor",
      "--yes"], "isolated_stack_start_failed");
    const result = spawnSync("supabase", ["test", "db", "--local", "--workdir", directory,
      path.join(root, "supabase/tests/database/publication_jobs.test.sql")], {
      cwd: root, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      const diagnostics = (result.stderr ?? "").split(/\r?\n/)
        .filter((line) => /ERROR:|DETAIL:|CONTEXT:|FATAL:/i.test(line))
        .slice(-5)
        .map((line) => line.replace(/[A-Za-z0-9_+/=-]{40,}/g, "[redacted]"));
      console.error(JSON.stringify({ stage: "publication_jobs_pgtap", output: result.stdout?.slice(-5000) ?? "", diagnostics }));
      throw new Error("publication_jobs_pgtap_failed");
    }
    const status = JSON.parse(command("supabase", ["status", "--workdir", directory, "--output", "json"], "isolated_status_failed"));
    assert.equal(status.API_URL, "http://127.0.0.1:56421");
    const serviceKey = status.SERVICE_ROLE_KEY;
    const publicKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
    assert.ok(serviceKey && publicKey);
    const headers = (key) => ({ apikey: key, ...(key.startsWith("eyJ") ? { authorization: `Bearer ${key}` } : {}) });
    const rpc = async (name, body, key = serviceKey) => fetch(`${status.API_URL}/rest/v1/rpc/${name}`, {
      method: "POST", headers: { ...headers(key), "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    const create = await fetch(`${status.API_URL}/rest/v1/categories`, {
      method: "POST", headers: { ...headers(serviceKey), "content-type": "application/json" },
      body: JSON.stringify({ slug: "publication-api-smoke", name: "Publication", description: "Test", icon: "gear", image: "" }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(create.status, 201);
    const publicClaim = await rpc("claim_publication_job", { p_lease_seconds: 120, p_debounce_seconds: 0 }, publicKey);
    assert.ok([401, 403, 404].includes(publicClaim.status));
    const publicRenew = await rpc("renew_publication_job", {
      p_token: "11111111-1111-4111-8111-111111111111", p_revision: 1, p_lease_seconds: 120,
    }, publicKey);
    assert.ok([401, 403, 404].includes(publicRenew.status));
    const publicState = await fetch(`${status.API_URL}/rest/v1/publication_jobs`, {
      headers: headers(publicKey), signal: AbortSignal.timeout(10_000),
    });
    assert.ok([401, 403, 404].includes(publicState.status));
    const queue = createPublicationQueueClient({ SUPABASE_URL: status.API_URL, PUBLICATION_SUPABASE_KEY: serviceKey });
    const [claimA, claimB] = await Promise.all([
      queue.claim(120, 0), queue.claim(120, 0),
    ]);
    const claims = [claimA, claimB].filter(Boolean);
    assert.equal(claims.length, 1);
    assert.equal(await queue.renew(claims[0].token, claims[0].revision, 120), true);
    const changed = await fetch(`${status.API_URL}/rest/v1/categories?slug=eq.publication-api-smoke`, {
      method: "PATCH", headers: { ...headers(serviceKey), "content-type": "application/json" },
      body: JSON.stringify({ name: "Changed during build" }), signal: AbortSignal.timeout(10_000),
    });
    assert.equal(changed.status, 204);
    assert.equal(await queue.renew(claims[0].token, claims[0].revision, 120), false);
    assert.equal(await queue.confirm(claims[0].token, claims[0].revision, "local-only"), false);
    const next = await queue.claim(120, 0);
    assert.ok(next);
    assert.ok(next.revision > claims[0].revision);
    assert.equal(await queue.fail(claims[0].token, "build_failed"), false);
    // A competing transaction holds the row past the lease expiry. A renewal
    // that began before the wait must still be refused after the wait.
    assert.equal(await whileLeaseExpiresUnderLock(projectId,
      () => queue.renew(next.token, next.revision, 120)), false);
    const afterExpiry = await queue.claim(120, 0);
    assert.ok(afterExpiry);
    assert.equal(await whileLeaseExpiresUnderLock(projectId,
      () => queue.confirm(afterExpiry.token, afterExpiry.revision, "local-expired")), false);
    const reclaimed = await whileLeaseExpiresUnderLock(projectId,
      () => queue.claim(120, 0));
    assert.ok(reclaimed);
    assert.equal(await whileLeaseExpiresUnderLock(projectId,
      () => queue.fail(reclaimed.token, "build_failed")), false);
    assert.equal(await whileLeaseExpiresUnderLock(projectId,
      () => queue.retry()), true);
  ok = true;
} finally {
  let stopped = !started;
  if (started) {
    try {
      command("supabase", ["stop", "--project-id", projectId, "--no-backup", "--yes"], "isolated_stack_stop_failed");
      stopped = true;
    } catch {
      process.exitCode = 1;
    }
  }
  const canonical = realpathSync(directory);
  if (path.dirname(canonical) !== realpathSync(os.tmpdir()) || !path.basename(canonical).startsWith(prefix)
    || canonical !== path.resolve(directory) || !lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) {
    throw new Error("unsafe_isolated_cleanup");
  }
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  console.log(JSON.stringify({ ok: ok && stopped && process.exitCode !== 1, isolatedStackStopped: stopped, cleanup: true }));
}
