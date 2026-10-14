import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseReadyUrl } from "./worker-smoke-lib.mjs";
import { readAdminPreviewRuntime } from "./admin-preview-runtime.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ASSETS = path.join(ROOT, "fixtures/cloudflare-admin-assets");
const WRANGLER = path.join(ROOT, ".wrangler/tools/wrangler-4.135.0/node_modules/wrangler/bin/wrangler.js");
const REPORT = path.join(ROOT, "dist/local-admin-auth-smoke/report.json");
const PORTS = Array.from({ length: 10 }, (_, index) => 56420 + index);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixtureCheck() {
  const login = readFileSync(path.join(ASSETS, "admin/login.html"), "utf8");
  const shell = readFileSync(path.join(ASSETS, "admin/index.html"), "utf8");
  const security = readFileSync(path.join(ASSETS, "admin/security.html"), "utf8");
  assert.match(login, /<form\b[^>]*method="post"[^>]*action="\/api\/admin\/login"/i);
  assert.match(login, /<!-- AUTH_MESSAGE -->/);
  assert.match(shell, /<form\b[^>]*method="post"[^>]*action="\/api\/admin\/logout"/i);
  assert.match(security, /<form\b[^>]*method="post"[^>]*action="\/api\/admin\/password"/i);
  for (const html of [login, shell, security]) {
    assert.doesNotMatch(html, /<script\b|\s+on[a-z]+\s*=|localStorage|sessionStorage/i);
  }
  return { ok: true, mode: "fixtures-only", login: true, shell: true };
}

export function command(program, args, code, timeout = 360_000) {
  const result = spawnSync(program, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) throw new Error(code);
  return result.stdout;
}

export async function assertPortsFree() {
  for (const port of PORTS) {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    await new Promise((resolve) => server.close(resolve));
  }
}

export function createIsolatedProject(directory, projectId) {
  cpSync(path.join(ROOT, "supabase"), path.join(directory, "supabase"), { recursive: true });
  const configPath = path.join(directory, "supabase/config.toml");
  const original = readFileSync(configPath, "utf8");
  const config = original
    .replace('project_id = "site-for-kirsan"', `project_id = "${projectId}"`)
    .replace(/\b543(\d{2})\b/g, "564$1")
    .replace(/(\[db.seed\][\s\S]*?enabled = )true/, "$1false");
  assert.notEqual(config, original);
  assert.match(config, /\[db.seed\][\s\S]*?enabled = false/);
  assert.doesNotMatch(config, /\b5432\d\b/);
  writeFileSync(configPath, config, { mode: 0o600 });
}

function privateHeaders(key) {
  const headers = { apikey: key, "content-type": "application/json" };
  if (key.startsWith("eyJ")) headers.authorization = `Bearer ${key}`;
  return headers;
}

async function seedReadOnlyProducts(apiUrl, key) {
  assert.equal(apiUrl, "http://127.0.0.1:56421");
  const category = await fetch(`${apiUrl}/rest/v1/categories`, {
    method: "POST", headers: privateHeaders(key),
    body: JSON.stringify({ slug: "preview-readonly", name: "Preview", description: "Test", icon: "gear", image: "", type: "brand" }),
  });
  assert.equal(category.status, 201);
  const response = await fetch(`${apiUrl}/rest/v1/products`, {
    method: "POST", headers: privateHeaders(key),
    body: JSON.stringify(Array.from({ length: 51 }, (_, index) => ({
      slug: `preview-${index + 1}`, name: `Preview ${String(index + 1).padStart(3, "0")}`,
      category_slug: "preview-readonly", short_description: "Isolated test only", article: `PREVIEW-${index + 1}`,
      published: index !== 0, order: index,
    }))),
  });
  assert.equal(response.status, 201);
}

function wranglerConfig(directory, apiUrl, publicKey, privateKey, password, sessionKey, cryptoKey, previewRuntime) {
  const file = path.join(directory, "wrangler.admin-local.jsonc");
  const config = {
    name: "ayprom-admin-local-prototype",
    main: path.join(ROOT, "src/cloudflare/worker.ts"),
    compatibility_date: "2026-09-19",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    assets: {
      directory: ASSETS,
      binding: "ASSETS",
      html_handling: "drop-trailing-slash",
      not_found_handling: "404-page",
      run_worker_first: ["/api/*", "/admin", "/admin/*"],
    },
    ...previewRuntime,
    vars: {
      SUPABASE_URL: apiUrl,
      SUPABASE_PUBLISHABLE_KEY: publicKey,
      ADMIN_SUPABASE_KEY: privateKey,
      ADMIN_PASSWORD: password,
      ADMIN_COOKIE_HMAC_KEY: sessionKey,
      ADMIN_CRYPTO_KEY: cryptoKey,
    },
  };
  writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
  return file;
}

export async function startWrangler(configPath, directory, { spawnProcess = spawn, readyTimeoutMs = 90_000 } = {}) {
  const child = spawnProcess(process.execPath, [
    WRANGLER, "dev", "--local", "--config", configPath,
    "--ip", "127.0.0.1", "--port", "0",
    "--inspector-ip", "127.0.0.1", "--inspector-port", "0",
    "--persist-to", path.join(directory, "wrangler-state"),
    "--show-interactive-dev-session=false", "--log-level", "info",
  ], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  let logs = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => {
    logs = (logs + chunk.toString()).slice(-16_000);
    const stages = chunk.toString().matchAll(/"code":"admin_products_unavailable","stage":"(request|fetch|count|decode|rows)"/g);
    for (const stage of stages) console.log(JSON.stringify({ diagnostic: "admin_products_unavailable", stage: stage[1] }));
  });
  try {
    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline && child.exitCode === null) {
      const base = parseReadyUrl(logs);
      if (base) {
        try {
          const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) });
          if (response.status === 200) return { child, base, productStages: () => Array.from(logs.matchAll(/"stage":"(request|fetch|count|decode|rows|handler|credential|redirect_option|fetch_binding|timeout_option)"/g), (match) => match[1]) };
        } catch { /* ready line may precede the listener */ }
      }
      await sleep(200);
    }
    throw new Error("workerd_not_ready");
  } catch (error) {
    await stopWrangler(child);
    throw error;
  }
}

export async function stopWrangler(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  if (await Promise.race([exited.then(() => true), sleep(5000).then(() => false)])) {
    if (process.platform === "win32") await sleep(2000);
    return;
  }
  if (process.platform === "win32" && Number.isSafeInteger(child.pid)) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else if (Number.isSafeInteger(child.pid)) {
    child.kill("SIGKILL");
  }
  await exited;
  if (process.platform === "win32") await sleep(2000);
}

async function rpc(apiUrl, key, name, body) {
  const response = await fetch(`${apiUrl}/rest/v1/rpc/${name}`, {
    method: "POST", headers: privateHeaders(key), body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function browserCheck(base, password) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${base}/admin/login`);
    assert.match(await page.title(), /AYPROM/);
    await page.getByLabel("Пароль").fill(password);
    await Promise.all([
      page.waitForURL(`${base}/admin`, { timeout: 15_000 }),
      page.getByRole("button", { name: "Войти" }).click(),
    ]);
    assert.match(await page.locator("h1").textContent(), /Локальный прототип админки/);
    await page.getByRole("link", { name: "Просмотр товаров" }).click();
    await page.waitForURL(`${base}/admin/products`);
    assert.equal(await page.locator("tbody tr").count(), 50);
    assert.match(await page.locator("tbody").textContent(), /Черновик/);
    await page.getByRole("link", { name: "Вперёд" }).click();
    await page.waitForURL(/page=2/);
    assert.equal(await page.locator("tbody tr").count(), 1);
    await page.getByLabel("Поиск").fill("Preview 051");
    await page.getByRole("button", { name: "Найти" }).click();
    await page.waitForURL(/q=Preview/);
    assert.equal(await page.locator("tbody tr").count(), 1);
    assert.match(await page.locator("tbody").textContent(), /Preview 051/);
    await Promise.all([
      page.waitForURL(`${base}/admin/login`, { timeout: 15_000 }),
      page.getByRole("button", { name: "Выйти" }).click(),
    ]);
    const guest = await page.goto(`${base}/admin`);
    assert.equal(guest?.url(), `${base}/admin/login`);
    await context.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  if (process.argv.length === 3 && process.argv[2] === "--fixtures-only") {
    console.log(JSON.stringify(fixtureCheck()));
    return;
  }
  let previewRuntime;
  if (process.argv.length === 4 && process.argv[2] === "--package") {
    previewRuntime = readAdminPreviewRuntime(process.argv[3]);
  } else if (process.argv.length !== 2) throw new Error("unsupported_arguments");
  fixtureCheck();
  assert.equal(existsSync(WRANGLER), true);
  await assertPortsFree();

  const directory = mkdtempSync(path.join(os.tmpdir(), "ayprom-admin-auth-"));
  const projectId = `ayprom-admin-auth-${randomBytes(5).toString("hex")}`;
  const password = randomBytes(24).toString("base64url");
  const hashPassword = randomBytes(24).toString("base64url");
  const salt = randomBytes(16);
  const passwordHash = `pbkdf2-sha256:600000:${salt.toString("base64url")}:${pbkdf2Sync(hashPassword, salt, 600000, 32, "sha256").toString("base64url")}`;
  const sessionKey = randomBytes(48).toString("base64url");
  const cryptoKey = randomBytes(48).toString("base64url");
  const report = { mode: previewRuntime ? "isolated-local-admin-preview" : "isolated-local", projectId, checks: [], cleanup: false, ok: false };
  let child = null;
  let cryptoServer = null;
  let stackAttempted = false;
  let apiUrl = null;
  try {
    createIsolatedProject(directory, projectId);
    stackAttempted = true;
    command("supabase", ["start", "--workdir", directory,
      "--exclude", "studio,realtime,storage-api,imgproxy,postgres-meta,mailpit,edge-runtime,logflare,vector,supavisor",
      "--yes"], "isolated_stack_start_failed");
    report.checks.push({ name: "isolated_stack_start", ok: true });
    const status = JSON.parse(command("supabase", ["status", "--workdir", directory, "--output", "json"], "isolated_stack_status_failed"));
    apiUrl = status.API_URL;
    assert.equal(apiUrl, "http://127.0.0.1:56421");
    const privateKey = status.SERVICE_ROLE_KEY;
    const publicKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
    assert.ok(privateKey && publicKey);
    const cryptoSource = path.join(directory, "src/lib/admin");
    mkdirSync(cryptoSource, { recursive: true });
    cpSync(path.join(ROOT, "src/lib/admin/password-credential.ts"), path.join(cryptoSource, "password-credential.ts"));
    const cryptoEnv = path.join(directory, "edge-crypto.env");
    writeFileSync(cryptoEnv, `AYPROM_ADMIN_CRYPTO_KEY=${cryptoKey}\n`, { mode: 0o600 });
    cryptoServer = spawn("supabase", ["functions", "serve", "--workdir", directory,
      "--env-file", cryptoEnv, "--no-verify-jwt"], {
      cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [cryptoServer.stdout, cryptoServer.stderr]) stream.on("data", () => {});
    let cryptoReady = false;
    for (let attempt = 0; attempt < 100 && cryptoServer.exitCode === null; attempt += 1) {
      try {
        const probe = await fetch(`${apiUrl}/functions/v1/admin-password-crypto`, {
          method: "POST", headers: { apikey: publicKey, "x-ayprom-admin-crypto-key": "wrong" },
          body: "{}", signal: AbortSignal.timeout(3000),
        });
        if (probe.status === 401) { cryptoReady = true; break; }
      } catch { /* local function runtime may still be starting */ }
      await sleep(300);
    }
    assert.equal(cryptoReady, true, "local_crypto_not_ready");
    report.checks.push({ name: "isolated_crypto_function_ready", ok: true });
    const credentials = await fetch(`${apiUrl}/rest/v1/admin_credentials?select=credential_key`, { headers: privateHeaders(privateKey) });
    assert.equal(credentials.status, 200);
    assert.deepEqual(await credentials.json(), []);
    report.checks.push({ name: "empty_credential_row_no_auth_identity", ok: true });
    await seedReadOnlyProducts(apiUrl, privateKey);
    report.checks.push({ name: "isolated_readonly_products_seed", ok: true });

    if (previewRuntime) {
      const noAuthConfig = path.join(directory, "wrangler.missing-auth.jsonc");
      writeFileSync(noAuthConfig, JSON.stringify({ ...previewRuntime, vars: { SUPABASE_URL: apiUrl, SUPABASE_PUBLISHABLE_KEY: publicKey } }), { mode: 0o600 });
      const unauth = await startWrangler(noAuthConfig, directory);
      child = unauth.child;
      assert.equal((await fetch(`${unauth.base}/admin`, { redirect: "manual" })).status, 503);
      assert.equal((await fetch(`${unauth.base}/api/health`)).status, 200);
      assert.equal((await fetch(`${unauth.base}/api/catalog/search`)).status, 200);
      await stopWrangler(child);
      child = null;
      report.checks.push({ name: "missing_admin_bindings_fail_closed_public_api_works", ok: true });
    }
    const config = wranglerConfig(directory, apiUrl, publicKey, privateKey, password, sessionKey, cryptoKey, previewRuntime);
    const started = await startWrangler(config, directory);
    child = started.child;
    let base = started.base;
    report.checks.push({ name: "workerd_ready", ok: true });
    async function check(name, action) {
      report.activeCheck = name;
      await action();
      report.checks.push({ name, ok: true });
      delete report.activeCheck;
    }
    const get = (url, options = {}) => fetch(`${base}${url}`, { redirect: "manual", ...options });
    const post = (url, passwordValue, origin = base) => get(url, {
      method: "POST",
      headers: { origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: passwordValue }),
    });

    if (previewRuntime) await check("packaged_public_pages_and_search", async () => {
      assert.equal((await get("/")).status, 200);
      assert.equal((await get("/catalog")).status, 200);
      assert.equal((await get("/api/catalog/search")).status, 200);
    });

    await check("guest_and_direct_asset_denied", async () => {
      const guest = await get("/admin");
      assert.equal(guest.status, 302);
      assert.equal(guest.headers.get("location"), "/admin/login");
      assert.equal((await get("/admin/index.html")).status, 404);
      assert.equal((await get("/admin/login.html")).status, 404);
      assert.equal((await get("/api/admin/products")).status, 401);
    });
    await check("login_html_sanitized_uncached", async () => {
      const response = await get("/admin/login?error=%3Cscript%3E&retry=%3Cimg%3E");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const html = await response.text();
      assert.doesNotMatch(html, /<script|<img/i);
      assert.doesNotMatch(html, /AUTH_MESSAGE/);
    });
    await check("csrf_origin_denied", async () => {
      assert.equal((await get("/api/admin/login", {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ password }),
      })).status, 400);
      assert.equal((await post("/api/admin/login", password, "https://other.example")).status, 400);
    });
    await check("wrong_password_denied", async () => {
      const response = await post("/api/admin/login", `${password}wrong`);
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"), "/admin/login?error=1");
      assert.equal(response.headers.get("set-cookie"), null);
    });
    let cookie;
    await check("success_and_cookie_gate", async () => {
      const response = await post("/api/admin/login", password);
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"), "/admin");
      cookie = response.headers.get("set-cookie")?.split(";")[0];
      assert.match(cookie, /^admin_session=/);
      const shell = await get("/admin", { headers: { cookie } });
      assert.equal(shell.status, 200);
      assert.equal(shell.headers.get("cache-control"), "no-store");
      assert.match(await shell.text(), /Локальный прототип админки/);
      assert.equal((await get("/admin", { headers: { cookie: `${cookie}tampered` } })).status, 302);
    });
    await check("expired_session_denied", async () => {
      const { createSessionCodec } = await import("../../src/lib/admin/session-codec.ts");
      const expired = await createSessionCodec(sessionKey, () => Date.now() - 8 * 86_400_000).create();
      assert.equal((await get("/admin", { headers: { cookie: `admin_session=${expired}` } })).status, 302);
    });
    await check("private_products_pagination_search_and_public_isolation", async () => {
      const headers = { cookie };
      report.activeCheck = "products_first_page";
      const first = await get("/api/admin/products", { headers });
      report.productProbe = { status: first.status, cache: first.headers.get("cache-control") };
      if (first.status !== 200) {
        const direct = await fetch(`${apiUrl}/rest/v1/products?select=id,slug,name,article,published&offset=0&limit=50&order=order.asc,id.asc`, { headers: { ...privateHeaders(privateKey), prefer: "count=exact" } });
        const rows = await direct.json();
        report.productProbe.backend = { status: direct.status, range: direct.headers.get("content-range"), count: Array.isArray(rows) ? rows.length : null,
          types: Array.isArray(rows) && rows[0] ? Object.fromEntries(Object.entries(rows[0]).map(([key, value]) => [key, value === null ? "null" : typeof value])) : null };
      }
      assert.equal(first.status, 200);
      assert.equal(first.headers.get("cache-control"), "no-store");
      const firstPage = await first.json();
      report.productProbe = { ...report.productProbe, total: firstPage.total, count: firstPage.items?.length, firstPublished: firstPage.items?.[0]?.published };
      assert.equal(firstPage.total, 51); assert.equal(firstPage.items.length, 50);
      assert.equal(firstPage.items[0].published, false);
      report.activeCheck = "products_second_page";
      const second = await (await get("/api/admin/products?page=2", { headers })).json();
      assert.equal(second.items.length, 1); assert.equal(second.items[0].name, "Preview 051");
      report.activeCheck = "products_article_search";
      const search = await (await get("/api/admin/products?q=PREVIEW-51", { headers })).json();
      assert.equal(search.total, 1);
      report.activeCheck = "products_empty_search";
      const empty = await (await get("/api/admin/products?q=absent-value", { headers })).json();
      assert.equal(empty.total, 0);
      report.activeCheck = "products_beyond_last_page";
      const beyond = await (await get("/api/admin/products?page=3", { headers })).json();
      assert.equal(beyond.total, 51); assert.equal(beyond.items.length, 0);
      report.activeCheck = "products_reject_invalid_and_write";
      assert.equal((await get("/api/admin/products?page=-1", { headers })).status, 400);
      assert.equal((await get("/api/admin/products", { method: "DELETE", headers })).status, 405);
      report.activeCheck = "public_excludes_draft";
      const publicPage = await (await get("/api/catalog/search?q=Preview")).json();
      assert.equal(publicPage.total, 50);
      assert.equal(publicPage.items.some((product) => product.slug === "preview-1"), false);
      delete report.productProbe;
    });
    await check("parallel_reservations_and_replay", async () => {
      const keyHash = randomBytes(32).toString("hex");
      const attempts = await Promise.all(Array.from({ length: 4 }, () => rpc(apiUrl, privateKey, "begin_admin_auth_attempt", {
        p_key_hash: keyHash, p_scope: "login", p_ttl_seconds: 30, p_max_concurrent: 3,
      })));
      const allowed = attempts.map((rows) => rows[0]).filter((row) => row.out_allowed);
      assert.equal(allowed.length, 3);
      for (const row of allowed) await rpc(apiUrl, privateKey, "finish_admin_auth_attempt", {
        p_reservation_id: row.out_reservation_id, p_password_is_valid: true,
      });
      const replay = await rpc(apiUrl, privateKey, "finish_admin_auth_attempt", {
        p_reservation_id: allowed[0].out_reservation_id, p_password_is_valid: true,
      });
      assert.equal(replay, 0);
    });
    await check("version_change_revokes_session", async () => {
      const response = await fetch(`${apiUrl}/rest/v1/admin_credentials`, {
        method: "POST",
        headers: { ...privateHeaders(privateKey), prefer: "return=minimal" },
        body: JSON.stringify({ credential_key: "primary", password_hash: passwordHash, session_version: 2 }),
      });
      assert.equal(response.status, 201);
      const old = await get("/admin", { headers: { cookie } });
      assert.equal(old.status, 302);
      assert.equal(old.headers.get("location"), "/admin/login?session=expired");
      assert.equal((await get("/api/admin/products", { headers: { cookie } })).status, 401);
    });
    await check("hash_login_disables_env_fallback", async () => {
      const oldPassword = await post("/api/admin/login", password);
      assert.equal(oldPassword.headers.get("location"), "/admin/login?error=1");
      assert.equal(oldPassword.headers.get("set-cookie"), null);
      const response = await post("/api/admin/login", hashPassword);
      assert.equal(response.headers.get("location"), "/admin");
      cookie = response.headers.get("set-cookie")?.split(";")[0];
      assert.match(cookie, /^admin_session=/);
      const { createSessionCodec } = await import("../../src/lib/admin/session-codec.ts");
      assert.equal((await createSessionCodec(sessionKey, Date.now).read(cookie.slice("admin_session=".length)))?.credentialVersion, 2);
      assert.equal((await get("/admin", { headers: { cookie } })).status, 200);
    });
    await check("browser_no_javascript_login_logout", async () => browserCheck(base, hashPassword));
    await check("hash_only_worker_without_env_password", async () => {
      await stopWrangler(child);
      child = null;
      const hashConfig = JSON.parse(readFileSync(config, "utf8"));
      delete hashConfig.vars.ADMIN_PASSWORD;
      const hashConfigFile = path.join(directory, "wrangler.hash-only.jsonc");
      writeFileSync(hashConfigFile, JSON.stringify(hashConfig), { mode: 0o600 });
      const hashWorker = await startWrangler(hashConfigFile, directory);
      child = hashWorker.child;
      base = hashWorker.base;
      const response = await post("/api/admin/login", hashPassword);
      assert.equal(response.headers.get("location"), "/admin");
      cookie = response.headers.get("set-cookie")?.split(";")[0];
      assert.match(cookie, /^admin_session=/);
      assert.equal((await get("/admin", { headers: { cookie } })).status, 200);
    });
    await check("password_change_revokes_every_old_session", async () => {
      assert.equal((await get("/admin/security", { headers: { cookie } })).status, 200);
      assert.equal((await get("/admin/security.html", { headers: { cookie } })).status, 404);
      const nextPassword = randomBytes(24).toString("base64url");
      const changed = await get("/api/admin/password", {
        method: "POST", headers: { origin: base, cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ currentPassword: hashPassword, newPassword: nextPassword, confirmPassword: nextPassword }),
      });
      assert.equal(changed.status, 303);
      assert.equal(changed.headers.get("location"), "/admin/login?changed=1");
      assert.match(changed.headers.get("set-cookie"), /admin_session=; Max-Age=0/);
      const stale = await get("/admin", { headers: { cookie } });
      assert.equal(stale.status, 302);
      assert.equal(stale.headers.get("location"), "/admin/login?session=expired");
      assert.equal((await post("/api/admin/login", hashPassword)).headers.get("location"), "/admin/login?error=1");
      const entered = await post("/api/admin/login", nextPassword);
      assert.equal(entered.headers.get("location"), "/admin");
      cookie = entered.headers.get("set-cookie")?.split(";")[0];
      assert.match(cookie, /^admin_session=/);
    });
    await stopWrangler(cryptoServer);
    cryptoServer = null;
    command("supabase", ["stop", "--project-id", projectId, "--no-backup", "--yes"], "isolated_stack_stop_failed");
    stackAttempted = false;
    await check("backend_outage_denies_shell", async () => {
      const response = await get("/admin", { headers: { cookie } });
      assert.notEqual(response.status, 200);
      assert.equal((await get("/api/admin/products", { headers: { cookie } })).status, 503);
      const loginOutage = await post("/api/admin/login", hashPassword);
      assert.equal(loginOutage.headers.get("location"), "/admin/login?error=security");
      assert.equal(loginOutage.headers.get("set-cookie"), null);
    });
    report.ok = true;
  } catch (error) {
    report.failure = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "local_smoke_check_failed";
  } finally {
    let cleanupOk = true;
    try { await stopWrangler(child); } catch { cleanupOk = false; }
    try { await stopWrangler(cryptoServer); } catch { cleanupOk = false; }
    if (stackAttempted) {
      try { command("supabase", ["stop", "--project-id", projectId, "--no-backup", "--yes"], "isolated_stack_stop_failed"); }
      catch { cleanupOk = false; report.failure = "isolated_stack_cleanup_failed"; }
    }
    const expectedPrefix = path.join(os.tmpdir(), "ayprom-admin-auth-");
    if (directory.startsWith(expectedPrefix) && path.dirname(directory) === os.tmpdir()) {
      let removed = false;
      for (let attempt = 0; attempt < 5 && !removed; attempt += 1) {
        try {
          rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
          removed = true;
        } catch {
          await sleep(1000);
        }
      }
      if (!removed) cleanupOk = false;
    } else cleanupOk = false;
    report.cleanup = cleanupOk;
    if (!cleanupOk) report.ok = false;
    mkdirSync(path.dirname(REPORT), { recursive: true });
    writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
    if (!report.ok || !report.cleanup) process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error(JSON.stringify({ ok: false, failure: "local_smoke_setup_failed" }));
    process.exitCode = 1;
  });
}
