// Real local PostgREST/Postgres CAS check for the otherwise unwired credential
// writer. Creates and stops only its own temporary Supabase project.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPortsFree,
  command,
  createIsolatedProject,
  startWrangler,
  stopWrangler,
} from "./local-admin-auth-smoke.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENTRY = path.join(ROOT, "tests/support/credential-writer-runtime-entry.ts");
const PREFIX = path.join(os.tmpdir(), "ayprom-credential-writer-postgrest-");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  assert.equal(existsSync(ENTRY), true);
  await assertPortsFree();

  const directory = mkdtempSync(PREFIX);
  const projectId = `ayprom-cas-${randomBytes(5).toString("hex")}`;
  const report = { ok: false, checks: [], cleanup: false };
  let stackAttempted = false;
  let child = null;
  try {
    createIsolatedProject(directory, projectId);
    stackAttempted = true;
    command("supabase", ["start", "--workdir", directory,
      "--exclude", "studio,realtime,storage-api,imgproxy,postgres-meta,mailpit,edge-runtime,logflare,vector,supavisor",
      "--yes"], "isolated_stack_start_failed");
    report.checks.push("isolated_stack_started");

    const status = JSON.parse(command("supabase", ["status", "--workdir", directory, "--output", "json"], "isolated_stack_status_failed"));
    assert.equal(status.API_URL, "http://127.0.0.1:56421");
    assert.ok(status.SERVICE_ROLE_KEY);
    report.checks.push("expected_loopback_backend");

    const configPath = path.join(directory, "wrangler.credential-writer.jsonc");
    writeFileSync(configPath, JSON.stringify({
      name: "ayprom-credential-writer-local-smoke",
      main: ENTRY,
      compatibility_date: "2026-09-19",
      compatibility_flags: ["nodejs_compat"],
      workers_dev: false,
      vars: { SUPABASE_URL: status.API_URL, ADMIN_SUPABASE_KEY: status.SERVICE_ROLE_KEY },
    }), { mode: 0o600 });
    const started = await startWrangler(configPath, directory);
    child = started.child;
    report.checks.push("workerd_ready");

    const request = async (pathValue) => {
      const response = await fetch(`${started.base}${pathValue}`, { signal: AbortSignal.timeout(15_000) });
      assert.equal(response.status, 200);
      return response.json();
    };
    async function check(name, action) {
      report.activeCheck = name;
      await action();
      report.checks.push(name);
      delete report.activeCheck;
    }
    const state = () => request("/state");
    const replace = (version) => request(`/replace?hash=golden&expected=${version}`);

    await check("empty_row_version_1", async () => {
      assert.deepEqual(await state(), { ok: true, hasHash: false, version: 1 });
    });
    await check("insert_version_2", async () => {
      assert.deepEqual(await replace(1), { ok: true, version: 2 });
      assert.deepEqual(await state(), { ok: true, hasHash: true, version: 2 });
    });
    await check("duplicate_insert_conflict", async () => {
      assert.deepEqual(await replace(1), { ok: false, code: "conflict" });
      assert.deepEqual(await state(), { ok: true, hasHash: true, version: 2 });
    });
    await check("conditional_update_version_3", async () => {
      assert.deepEqual(await replace(2), { ok: true, version: 3 });
    });
    await check("stale_update_conflict", async () => {
      assert.deepEqual(await replace(2), { ok: false, code: "conflict" });
      assert.deepEqual(await state(), { ok: true, hasHash: true, version: 3 });
    });
    await check("parallel_writers_one_wins", async () => {
      const results = await Promise.all([replace(3), replace(3)]);
      assert.equal(results.filter((value) => value.ok === true && value.version === 4).length, 1);
      assert.equal(results.filter((value) => value.ok === false && value.code === "conflict").length, 1);
      assert.deepEqual(await state(), { ok: true, hasHash: true, version: 4 });
    });
    report.ok = true;
  } catch {
    report.failure = report.activeCheck ?? "local_postgrest_smoke_failed";
  } finally {
    let cleanup = true;
    try { await stopWrangler(child); } catch { cleanup = false; }
    if (stackAttempted) {
      try { command("supabase", ["stop", "--project-id", projectId, "--no-backup", "--yes"], "isolated_stack_stop_failed"); }
      catch { cleanup = false; }
    }
    if (directory.startsWith(PREFIX) && path.dirname(directory) === os.tmpdir()) {
      let removed = false;
      for (let attempt = 0; attempt < 5 && !removed; attempt += 1) {
        try { rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); removed = true; }
        catch { await sleep(1000); }
      }
      if (!removed) cleanup = false;
    } else cleanup = false;
    report.cleanup = cleanup;
    if (!cleanup) report.ok = false;
    delete report.activeCheck;
    console.log(JSON.stringify(report));
    if (!report.ok) process.exitCode = 1;
  }
}

await main();
