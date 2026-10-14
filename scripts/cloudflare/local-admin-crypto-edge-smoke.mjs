// Real local Supabase Edge Runtime probe, isolated from the shared stack.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { assertPortsFree, command, createIsolatedProject, startWrangler, stopWrangler } from "./local-admin-auth-smoke.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PREFIX = "ayprom-admin-crypto-edge-";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function canRemove(directory) {
  const canonical = realpathSync(directory);
  return path.dirname(canonical) === realpathSync(os.tmpdir())
    && path.basename(canonical).startsWith(PREFIX)
    && canonical === path.resolve(directory)
    && lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink();
}

async function main() {
  await assertPortsFree();
  const directory = mkdtempSync(path.join(os.tmpdir(), PREFIX));
  const projectId = `ayprom-crypto-edge-${randomBytes(5).toString("hex")}`;
  const secret = randomBytes(48).toString("base64url");
  const password = randomBytes(24).toString("base64url");
  const salt = randomBytes(16);
  const hash = `pbkdf2-sha256:600000:${salt.toString("base64url")}:${pbkdf2Sync(password, salt, 600_000, 32, "sha256").toString("base64url")}`;
  const report = { kind: "local-admin-crypto-edge", checks: [], cleanup: false, ok: false };
  let functionServer = null;
  let worker = null;
  let stackAttempted = false;
  try {
    createIsolatedProject(directory, projectId);
    const target = path.join(directory, "src/lib/admin");
    mkdirSync(target, { recursive: true });
    cpSync(path.join(ROOT, "src/lib/admin/password-credential.ts"), path.join(target, "password-credential.ts"));
    const envPath = path.join(directory, "edge.env");
    writeFileSync(envPath, `AYPROM_ADMIN_CRYPTO_KEY=${secret}\n`, { mode: 0o600 });
    stackAttempted = true;
    command("supabase", ["start", "--workdir", directory,
      "--exclude", "studio,realtime,storage-api,imgproxy,postgres-meta,mailpit,edge-runtime,logflare,vector,supavisor",
      "--yes"], "isolated_stack_start_failed");
    report.checks.push("isolated_stack_started");
    const status = JSON.parse(command("supabase", ["status", "--workdir", directory, "--output", "json"], "isolated_status_failed"));
    assert.equal(status.API_URL, "http://127.0.0.1:56421");
    const publicKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
    const privateKey = status.SERVICE_ROLE_KEY;
    assert.ok(publicKey && privateKey);

    functionServer = spawn("supabase", ["functions", "serve", "--workdir", directory, "--env-file", envPath, "--no-verify-jwt"], {
      cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    for (const stream of [functionServer.stdout, functionServer.stderr]) stream.on("data", (chunk) => {
      output = (output + chunk.toString()).slice(-4000);
    });
    const endpoint = `${status.API_URL}/functions/v1/admin-password-crypto`;
    const call = (body, key = secret) => fetch(endpoint, {
      method: "POST",
      headers: { apikey: publicKey, "x-ayprom-admin-crypto-key": key, "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    let ready = false;
    for (let attempts = 0; attempts < 100 && functionServer.exitCode === null; attempts += 1) {
      try {
        const response = await call({ operation: "verify", password: "wrong", encodedHash: hash }, "wrong-key");
        if (response.status === 401) { ready = true; break; }
      } catch { /* runtime may still be starting */ }
      await sleep(300);
    }
    assert.equal(ready, true, "edge_runtime_not_ready");
    report.checks.push("real_edge_runtime_started");
    const correct = await call({ operation: "verify", password, encodedHash: hash });
    const wrong = await call({ operation: "verify", password: `${password}-wrong`, encodedHash: hash });
    assert.equal(correct.status, 200);
    assert.deepEqual(await correct.json(), { valid: true });
    assert.equal(wrong.status, 200);
    assert.deepEqual(await wrong.json(), { valid: false });
    report.checks.push("existing_hash_correct_and_wrong_password");
    const generated = await call({ operation: "hash", password });
    assert.equal(generated.status, 200);
    const result = await generated.json();
    assert.match(result.hash, /^pbkdf2-sha256:600000:/);
    report.checks.push("new_hash_same_format");

    const privateHeaders = { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" };
    const inserted = await fetch(`${status.API_URL}/rest/v1/admin_credentials`, {
      method: "POST", headers: privateHeaders,
      body: JSON.stringify({ credential_key: "primary", password_hash: hash, session_version: 2 }),
    });
    assert.equal(inserted.status, 201);
    const config = path.join(directory, "wrangler.admin-remote-crypto.jsonc");
    writeFileSync(config, JSON.stringify({
      name: "ayprom-admin-crypto-edge-local",
      main: path.join(ROOT, "src/cloudflare/worker.ts"),
      compatibility_date: "2026-09-19",
      compatibility_flags: ["nodejs_compat"],
      assets: { directory: path.join(ROOT, "fixtures/cloudflare-admin-assets"), binding: "ASSETS",
        html_handling: "drop-trailing-slash", not_found_handling: "404-page",
        run_worker_first: ["/api/*", "/admin", "/admin/*"] },
      vars: {
        SUPABASE_URL: status.API_URL, SUPABASE_PUBLISHABLE_KEY: publicKey,
        ADMIN_SUPABASE_KEY: privateKey, ADMIN_PASSWORD: randomBytes(24).toString("base64url"),
        ADMIN_COOKIE_HMAC_KEY: randomBytes(48).toString("base64url"), ADMIN_CRYPTO_KEY: secret,
      },
    }), { mode: 0o600 });
    worker = await startWrangler(config, directory);
    const login = (candidate) => fetch(`${worker.base}/api/admin/login`, {
      method: "POST", redirect: "manual",
      headers: { origin: worker.base, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: candidate }),
    });
    const wrongLogin = await login(`${password}-wrong`);
    assert.equal(wrongLogin.headers.get("location"), "/admin/login?error=1");
    assert.equal(wrongLogin.headers.get("set-cookie"), null);
    const accepted = await login(password);
    assert.equal(accepted.headers.get("location"), "/admin");
    const cookie = accepted.headers.get("set-cookie")?.split(";")[0];
    assert.match(cookie, /^admin_session=/);
    assert.equal((await fetch(`${worker.base}/admin`, { redirect: "manual", headers: { cookie } })).status, 200);
    report.checks.push("real_workerd_login_uses_remote_crypto");

    const replacement = randomBytes(24).toString("base64url");
    const replacementResponse = await call({ operation: "hash", password: replacement });
    assert.equal(replacementResponse.status, 200);
    const replacementHash = (await replacementResponse.json()).hash;
    const updated = await fetch(`${status.API_URL}/rest/v1/admin_credentials?credential_key=eq.primary&session_version=eq.2`, {
      method: "PATCH", headers: { ...privateHeaders, prefer: "return=representation" },
      body: JSON.stringify({ password_hash: replacementHash, session_version: 3 }),
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).length, 1);
    const oldSession = await fetch(`${worker.base}/admin`, { redirect: "manual", headers: { cookie } });
    assert.equal(oldSession.status, 302);
    assert.equal(oldSession.headers.get("location"), "/admin/login?session=expired");
    assert.equal((await login(password)).headers.get("location"), "/admin/login?error=1");
    assert.equal((await login(replacement)).headers.get("location"), "/admin");
    report.checks.push("password_change_revokes_old_session");
    report.ok = true;
  } catch {
    report.failure = "edge_probe_failed";
  } finally {
    let clean = true;
    try { await stopWrangler(worker?.child); } catch { clean = false; }
    try { await stopWrangler(functionServer); } catch { clean = false; }
    if (stackAttempted) {
      try { command("supabase", ["stop", "--project-id", projectId, "--no-backup", "--yes"], "isolated_stop_failed"); }
      catch { clean = false; }
    }
    try {
      if (!existsSync(directory) || !canRemove(directory)) throw new Error("unsafe_temp_directory");
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch { clean = false; }
    report.cleanup = clean;
    if (!clean) report.ok = false;
    console.log(JSON.stringify(report));
    if (!report.ok) process.exitCode = 1;
  }
}

main().catch(() => {
  console.error(JSON.stringify({ kind: "local-admin-crypto-edge", ok: false, failure: "setup_failed" }));
  process.exitCode = 1;
});
