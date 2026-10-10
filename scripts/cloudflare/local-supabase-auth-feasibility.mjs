// Diagnostic only: checks the existing Supabase Auth adapter against a fresh
// isolated local GoTrue/PostgREST stack and a real local workerd. Never uses
// production credentials, deploys, or modifies the shared local Supabase stack.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { assertPortsFree, command, createIsolatedProject, startWrangler, stopWrangler } from "./local-admin-auth-smoke.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WRANGLER = path.join(ROOT, ".wrangler/tools/wrangler-4.135.0/node_modules/wrangler/bin/wrangler.js");
const TEMP_PREFIX = "ayprom-supabase-auth-feasibility-";

function testDirectoryCanBeRemoved(directory) {
  const canonicalParent = realpathSync(os.tmpdir());
  const canonicalDirectory = realpathSync(directory);
  return path.dirname(canonicalDirectory) === canonicalParent
    && path.basename(canonicalDirectory).startsWith(TEMP_PREFIX)
    && canonicalDirectory === path.resolve(directory)
    && lstatSync(directory).isDirectory()
    && !lstatSync(directory).isSymbolicLink();
}

function configFile(directory, apiUrl, publicKey, privateKey, email, userId, sessionKey) {
  const file = path.join(directory, "wrangler.supabase-auth-feasibility.jsonc");
  writeFileSync(file, JSON.stringify({
    name: "ayprom-supabase-auth-feasibility-local",
    main: path.join(ROOT, "tests/support/supabase-auth-feasibility-entry.ts"),
    compatibility_date: "2026-09-19",
    compatibility_flags: ["nodejs_compat"],
    assets: {
      directory: path.join(ROOT, "fixtures/cloudflare-admin-assets"),
      binding: "ASSETS",
      html_handling: "drop-trailing-slash",
      not_found_handling: "404-page",
      run_worker_first: ["/api/*", "/admin", "/admin/*"],
    },
    vars: {
      SUPABASE_URL: apiUrl,
      SUPABASE_PUBLISHABLE_KEY: publicKey,
      ADMIN_SUPABASE_KEY: privateKey,
      ADMIN_AUTH_EMAIL: email,
      ADMIN_AUTH_USER_ID: userId,
      ADMIN_COOKIE_HMAC_KEY: sessionKey,
    },
  }), { mode: 0o600 });
  return file;
}

async function main() {
  assert.equal(existsSync(WRANGLER), true, "pinned_wrangler_missing");
  await assertPortsFree();
  const directory = mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  const projectId = `ayprom-auth-feasibility-${randomBytes(5).toString("hex")}`;
  const password = randomBytes(24).toString("base64url");
  const replacement = randomBytes(24).toString("base64url");
  const email = `probe-${randomBytes(5).toString("hex")}@example.invalid`;
  const sessionKey = randomBytes(48).toString("base64url");
  const report = { kind: "local-supabase-auth-feasibility", checks: [], observation: null, cleanup: false, ok: false };
  let running = null;
  let stackAttempted = false;

  try {
    createIsolatedProject(directory, projectId);
    stackAttempted = true;
    command("supabase", ["start", "--workdir", directory,
      "--exclude", "studio,realtime,storage-api,imgproxy,postgres-meta,mailpit,edge-runtime,logflare,vector,supavisor",
      "--yes"], "isolated_stack_start_failed");
    report.checks.push("isolated_stack_started");

    const status = JSON.parse(command("supabase", ["status", "--workdir", directory, "--output", "json"], "isolated_stack_status_failed"));
    const apiUrl = status.API_URL;
    assert.equal(apiUrl, "http://127.0.0.1:56421");
    const privateKey = status.SERVICE_ROLE_KEY;
    const publicKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
    assert.ok(privateKey && publicKey);
    const admin = createClient(apiUrl, privateKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(created.error, null, "isolated_user_create_failed");
    const userId = created.data.user?.id;
    assert.match(userId, /^[0-9a-f-]{36}$/i);
    report.checks.push("fictitious_user_created");

    const config = configFile(directory, apiUrl, publicKey, privateKey, email, userId, sessionKey);
    running = await startWrangler(config, directory);
    report.checks.push("real_local_workerd_started");
    const base = running.base;
    const get = (pathname, init = {}) => fetch(`${base}${pathname}`, { redirect: "manual", ...init });
    const login = (candidate) => get("/api/admin/login", {
      method: "POST",
      headers: { origin: base, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: candidate }),
    });

    const guest = await get("/admin");
    assert.equal(guest.status, 302);
    assert.equal(guest.headers.get("location"), "/admin/login");
    report.checks.push("guest_denied");

    const wrong = await login(`${password}-wrong`);
    assert.equal(wrong.status, 303);
    assert.equal(wrong.headers.get("location"), "/admin/login?error=1");
    assert.equal(wrong.headers.get("set-cookie"), null);
    report.checks.push("wrong_password_denied_by_real_auth");

    const accepted = await login(password);
    assert.equal(accepted.status, 303);
    assert.equal(accepted.headers.get("location"), "/admin");
    const cookie = accepted.headers.get("set-cookie")?.split(";")[0];
    assert.match(cookie, /^admin_session=/);
    assert.equal((await get("/admin", { headers: { cookie } })).status, 200);
    report.checks.push("correct_password_opens_admin_shell");

    const changed = await admin.auth.admin.updateUserById(userId, { password: replacement });
    assert.equal(changed.error, null, "isolated_password_change_failed");
    const oldPassword = await login(password);
    assert.equal(oldPassword.headers.get("location"), "/admin/login?error=1");
    const newPassword = await login(replacement);
    assert.equal(newPassword.headers.get("location"), "/admin");
    report.checks.push("auth_password_replacement_checked");

    // Current Auth adapter uses a separate admin_credentials version. A change
    // in GoTrue alone does not bump that version, so this observation is a
    // release blocker if the previous Worker cookie is still accepted.
    const previousCookie = await get("/admin", { headers: { cookie } });
    report.observation = {
      previousWorkerCookieAfterAuthPasswordChange: previousCookie.status,
      safeToUseAsDropInReplacement: previousCookie.status !== 200,
    };
    assert.ok([200, 302].includes(previousCookie.status));
    report.checks.push("previous_worker_cookie_status_recorded");

    report.ok = true;
  } catch {
    report.failure = "local_auth_probe_failed";
  } finally {
    let cleanup = true;
    try { await stopWrangler(running?.child); } catch { cleanup = false; }
    if (stackAttempted) {
      try { command("supabase", ["stop", "--project-id", projectId, "--no-backup", "--yes"], "isolated_stack_stop_failed"); }
      catch { cleanup = false; }
    }
    try {
      if (!testDirectoryCanBeRemoved(directory)) throw new Error("unsafe_temp_directory");
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch { cleanup = false; }
    report.cleanup = cleanup;
    if (!cleanup) report.ok = false;
    console.log(JSON.stringify(report));
    if (!report.ok) process.exitCode = 1;
  }
}

main().catch(() => {
  console.error(JSON.stringify({ kind: "local-supabase-auth-feasibility", ok: false, failure: "setup_failed" }));
  process.exitCode = 1;
});
