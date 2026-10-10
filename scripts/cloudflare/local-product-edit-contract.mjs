// Real local end-to-end contract for the thin admin product edit flow:
// fresh isolated Supabase (own project id, ports 565xx) → real PostgREST and
// migrations → real local workerd. Never touches the shared local stack, other
// isolated stacks (564xx), remote Supabase, Cloudflare or Vercel.
// Run: node --experimental-transform-types scripts/cloudflare/local-product-edit-contract.mjs
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { cpSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { command, startWrangler, stopWrangler } from "./local-admin-auth-smoke.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PREFIX = "ayprom-product-edit-contract-";
const PORTS = Array.from({ length: 10 }, (_, index) => 56520 + index);
const API = "http://127.0.0.1:56521";
const COOKIE_SECRET = `local-edit-contract-${randomBytes(16).toString("hex")}`;
const ENV_PASSWORD = `local-edit-contract-${randomBytes(12).toString("hex")}`;
let failureStage = "setup";
register("./static-producer-loader.mjs", { parentURL: import.meta.url, data: { srcRoot: path.join(ROOT, "src") } });
const { createAdminProductMutationPorts } = await import(pathToFileURL(path.join(ROOT, "src/cloudflare/admin/product-mutation-ports.ts")).href);
const { GOLDEN_PBKDF2_HASH } = await import(pathToFileURL(path.join(ROOT, "tests/support/legacy-password-verifier-fixtures.ts")).href);
const { injectedMarkup, submitEditForm } = await import(pathToFileURL(path.join(ROOT, "tests/support/no-js-form.ts")).href);

function safeToRemove(directory) {
  const canonical = realpathSync(directory);
  return path.dirname(canonical) === realpathSync(os.tmpdir())
    && path.basename(canonical).startsWith(PREFIX)
    && canonical === path.resolve(directory)
    && lstatSync(directory).isDirectory()
    && !lstatSync(directory).isSymbolicLink();
}

async function assertPortsFree() {
  for (const port of PORTS) {
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
    await new Promise((resolve) => server.close(resolve));
  }
}

function createProject(directory, projectId) {
  cpSync(path.join(ROOT, "supabase"), path.join(directory, "supabase"), { recursive: true });
  const configPath = path.join(directory, "supabase/config.toml");
  const original = readFileSync(configPath, "utf8");
  const config = original
    .replace('project_id = "site-for-kirsan"', `project_id = "${projectId}"`)
    .replace(/\b543(\d{2})\b/g, "565$1")
    .replace(/(\[db.seed\][\s\S]*?enabled = )true/, "$1false");
  assert.notEqual(config, original);
  assert.match(config, /\[db.seed\][\s\S]*?enabled = false/);
  assert.doesNotMatch(config, /\b543\d\d\b|\b564\d\d\b/);
  writeFileSync(configPath, config, { mode: 0o600 });
}

function privateHeaders(key, extra = {}) {
  const headers = { apikey: key, "content-type": "application/json", ...extra };
  if (key.startsWith("eyJ")) headers.authorization = `Bearer ${key}`;
  return headers;
}

async function rest(pathname, key, init = {}) {
  const response = await fetch(`${API}${pathname}`, { ...init, headers: privateHeaders(key, init.headers), signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

function workerConfig(directory, name, main, vars) {
  const file = path.join(directory, `${name}.json`);
  writeFileSync(file, JSON.stringify({
    name, main, compatibility_date: "2026-09-19", compatibility_flags: ["nodejs_compat"],
    assets: { directory: path.join(ROOT, "fixtures/cloudflare-admin-assets"), binding: "ASSETS", run_worker_first: ["/api/*", "/admin", "/admin/*"] },
    vars,
  }), { mode: 0o600 });
  return file;
}

const form = (base, action, body, cookie, origin = base) => fetch(`${base}${action}`, {
  method: "POST", redirect: "manual", body,
  headers: { origin, cookie, "content-type": "application/x-www-form-urlencoded" },
});

async function main() {
  await assertPortsFree();
  const directory = mkdtempSync(path.join(os.tmpdir(), PREFIX));
  const projectId = `ayprom-product-edit-${randomBytes(5).toString("hex")}`;
  const checks = [];
  const workers = [];
  let started = false;
  let cleanup = false;
  let passed = false;
  try {
    failureStage = "isolated_stack_start";
    createProject(directory, projectId);
    started = true;
    command("supabase", ["start", "--workdir", directory,
      "--exclude", "studio,realtime,storage-api,imgproxy,postgres-meta,mailpit,edge-runtime,logflare,vector,supavisor",
      "--yes"], "isolated_stack_start_failed");
    const status = JSON.parse(command("supabase", ["status", "--workdir", directory, "--output", "json"], "isolated_status_failed"));
    assert.equal(status.API_URL, API);
    const privateKey = status.SERVICE_ROLE_KEY;
    const publicKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
    assert.ok(privateKey && publicKey, "isolated_keys_missing");
    checks.push("fresh_migrations_applied");

    failureStage = "fixtures";
    for (const [table, row] of [
      ["categories", { slug: "edit-pumps", name: "Edit pumps", description: "Local test only", icon: "gear", image: "", type: "subcategory" }],
      ["subcategories", { category_slug: "edit-pumps", slug: "edit-gear", name: "Gear", image: "" }],
      ["brands", { slug: "edit-brand", name: "Edit brand", country: "Test", logo: "" }],
    ]) assert.equal((await rest(`/rest/v1/${table}`, privateKey, { method: "POST", body: JSON.stringify(row) })).status, 201, `${table}_fixture`);
    const hostileName = '"><script>alert(1)</script> Насос';
    const created = await createAdminProductMutationPorts({ SUPABASE_URL: API, ADMIN_SUPABASE_KEY: privateKey }).create({
      slugBase: "edit-pump", name: hostileName, categorySlug: "edit-pumps", subcategorySlug: "edit-gear",
      shortDescription: "Local test only", description: "Line 1\nLine 2 </textarea><img src=x onerror=alert(2)>", article: "EDIT-1",
      published: false, availability: "in_stock", metaTitle: null, metaDescription: null,
      characteristics: [{ attribute: "Pressure", value: "200 bar" }, { attribute: "Flow", value: "40 l/min" }],
      compatibleBrands: ["edit-brand"], vehicleTypes: [],
    });
    assert.equal(created.slug, "edit-pump");
    const publicDraft = await fetch(`${API}/rest/v1/products?select=id&slug=eq.edit-pump`, { headers: { apikey: publicKey } });
    assert.deepEqual(await publicDraft.json(), [], "public_key_reads_draft");
    checks.push("draft_fixture_hidden_from_public_key");

    failureStage = "workerd_start";
    const edit = await startWrangler(workerConfig(directory, "ayprom-product-edit-contract", path.join(ROOT, "tests/support/product-edit-runtime-entry.ts"), {
      SUPABASE_URL: API, ADMIN_SUPABASE_KEY: privateKey, ADMIN_COOKIE_HMAC_KEY: COOKIE_SECRET, ADMIN_PASSWORD: ENV_PASSWORD,
    }), directory);
    workers.push(edit);
    const base = edit.base;

    failureStage = "guest";
    assert.equal((await fetch(`${base}/api/admin/products/edit-pump`)).status, 401);
    assert.equal((await fetch(`${base}/admin/products/edit-pump/edit`, { redirect: "manual" })).status, 302);
    checks.push("guest_denied_before_draft_read");

    failureStage = "login";
    const login = await fetch(`${base}/api/admin/login`, {
      method: "POST", redirect: "manual", body: new URLSearchParams({ password: ENV_PASSWORD }),
      headers: { origin: base, "content-type": "application/x-www-form-urlencoded" },
    });
    assert.equal(login.status, 303);
    const cookie = /admin_session=[^;]+/.exec(login.headers.get("set-cookie") ?? "")?.[0];
    assert.ok(cookie, "login_cookie_missing");
    checks.push("real_login_through_isolated_rpcs");

    failureStage = "read_contract";
    const db = async () => (await rest(`/rest/v1/products?select=slug,name,description,updated_at,product_characteristics(attribute,value),product_brands(brand_slug),subcategories(slug)&id=eq.${created.id}`, privateKey)).json[0];
    const stored = await db();
    const api = await fetch(`${base}/api/admin/products/edit-pump`, { headers: { cookie } });
    assert.equal(api.status, 200);
    assert.equal(api.headers.get("cache-control"), "no-store");
    const detail = await api.json();
    assert.equal(detail.updatedAt, stored.updated_at, "cas_timestamp_not_verbatim");
    assert.match(detail.updatedAt, /\.\d{4,6}/, "postgrest_timestamp_lacks_microseconds");
    assert.equal(detail.name, hostileName);
    assert.deepEqual(detail.characteristics, [{ attribute: "Pressure", value: "200 bar" }, { attribute: "Flow", value: "40 l/min" }]);
    assert.deepEqual(detail.compatibleBrands, ["edit-brand"]);
    assert.equal(detail.subcategorySlug, "edit-gear");
    assert.equal(detail.published, false);
    checks.push("private_read_exact_microsecond_cas_timestamp");

    failureStage = "edit_page";
    const page = await fetch(`${base}/admin/products/edit-pump/edit`, { headers: { cookie } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.deepEqual(injectedMarkup(html), [], "markup_injected");
    const original = submitEditForm(html);
    assert.equal(original.disabled, false);
    assert.equal(original.body.get("expectedUpdatedAt"), stored.updated_at);
    checks.push("escaped_no_script_form");

    failureStage = "save";
    const changed = new URLSearchParams(original.body);
    changed.set("name", "Насос обновлён");
    changed.set("slug", "edit-pump-renamed");
    const saved = await form(base, original.action, changed, cookie);
    assert.equal(saved.status, 303);
    assert.equal(saved.headers.get("location"), "/admin/products/edit-pump-renamed/edit?saved=1");
    const afterSave = await db();
    assert.equal(afterSave.slug, "edit-pump-renamed");
    assert.equal(afterSave.name, "Насос обновлён");
    assert.equal(afterSave.description, stored.description, "description_changed_by_round_trip");
    assert.deepEqual(afterSave.product_characteristics.map(({ attribute, value }) => ({ attribute, value })).sort((a, b) => a.attribute.localeCompare(b.attribute)),
      stored.product_characteristics.map(({ attribute, value }) => ({ attribute, value })).sort((a, b) => a.attribute.localeCompare(b.attribute)));
    assert.deepEqual(afterSave.product_brands, stored.product_brands);
    assert.deepEqual(afterSave.subcategories, stored.subcategories);
    assert.notEqual(afterSave.updated_at, stored.updated_at);
    const savedPage = await fetch(`${base}/admin/products/edit-pump-renamed/edit?saved=1`, { headers: { cookie } });
    assert.match(await savedPage.text(), /Изменения сохранены\./);
    checks.push("form_save_renames_without_losing_relations");

    failureStage = "conflict";
    const staleTab = new URLSearchParams(original.body);
    staleTab.set("name", "Stale tab must not win");
    const conflict = await form(base, "/admin/products/edit-pump-renamed/edit", staleTab, cookie);
    assert.equal(conflict.status, 409);
    const conflictHtml = await conflict.text();
    assert.match(conflictHtml, /Товар изменён/);
    assert.match(conflictHtml, /Stale tab must not win/);
    assert.doesNotMatch(conflictHtml, /55000|другим администратором\. Обновите/);
    assert.equal((await db()).name, "Насос обновлён");
    checks.push("stale_form_conflict_409_without_write");

    failureStage = "invalid_reference";
    const fresh = submitEditForm(await (await fetch(`${base}/admin/products/edit-pump-renamed/edit`, { headers: { cookie } })).text());
    const invalid = new URLSearchParams(fresh.body);
    invalid.set("categorySlug", "missing-category");
    const invalidResponse = await form(base, fresh.action, invalid, cookie);
    assert.equal(invalidResponse.status, 400);
    const invalidHtml = await invalidResponse.text();
    assert.match(invalidHtml, /Проверьте адрес, категорию/);
    assert.doesNotMatch(invalidHtml, /Выбранная категория не найдена|22023/);
    assert.equal((await db()).name, "Насос обновлён");
    checks.push("sql_22023_shown_as_invalid_without_db_text");

    failureStage = "foreign_origin";
    assert.equal((await form(base, fresh.action, fresh.body, cookie, "https://attacker.example")).status, 400);
    assert.equal((await db()).updated_at, afterSave.updated_at);
    checks.push("foreign_origin_no_write");

    failureStage = "application_worker";
    const app = await startWrangler(workerConfig(directory, "ayprom-product-edit-app", path.join(ROOT, "src/cloudflare/worker.ts"), {
      SUPABASE_URL: API, SUPABASE_PUBLISHABLE_KEY: publicKey, ADMIN_SUPABASE_KEY: privateKey,
      ADMIN_COOKIE_HMAC_KEY: COOKIE_SECRET, ADMIN_PASSWORD: ENV_PASSWORD, ADMIN_CRYPTO_KEY: `local-${randomBytes(16).toString("hex")}`,
    }), directory);
    workers.push(app);
    const appRead = await fetch(`${app.base}/api/admin/products/edit-pump-renamed`, { headers: { cookie } });
    assert.equal(appRead.status, 200);
    assert.equal((await appRead.json()).updatedAt, afterSave.updated_at);
    const appPage = await (await fetch(`${app.base}/admin/products/edit-pump-renamed/edit`, { headers: { cookie } })).text();
    const appForm = submitEditForm(appPage);
    assert.equal(appForm.disabled, true);
    appForm.body.set("name", "Application worker must not write");
    assert.equal((await form(app.base, appForm.action, appForm.body, cookie)).status, 503);
    assert.equal((await fetch(`${app.base}/api/admin/products/edit-pump-renamed`, {
      method: "PUT", headers: { origin: app.base, cookie, "content-type": "application/json" }, body: "{}",
    })).status, 404);
    assert.equal((await db()).updated_at, afterSave.updated_at);
    checks.push("application_worker_reads_but_never_writes");

    failureStage = "browser_edit";
    const browserProduct = await createAdminProductMutationPorts({ SUPABASE_URL: API, ADMIN_SUPABASE_KEY: privateKey }).create({
      slugBase: "browser-pump", name: "Browser original", categorySlug: "edit-pumps", subcategorySlug: "edit-gear",
      shortDescription: "Browser test only", description: "Browser description", article: "BROWSER-1",
      published: false, availability: "in_stock", metaTitle: null, metaDescription: null,
      characteristics: [], compatibleBrands: ["edit-brand"], vehicleTypes: [],
    });
    failureStage = "browser_edit_fixture";
    assert.equal(browserProduct.slug, "browser-pump");
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ javaScriptEnabled: false });
      const browserErrors = [];
      const page = await context.newPage();
      page.on("pageerror", (error) => browserErrors.push(error.message));
      failureStage = "browser_edit_login";
      await page.goto(`${base}/admin/login`);
      await page.getByLabel("Пароль").fill(ENV_PASSWORD);
      await Promise.all([
        page.waitForURL(`${base}/admin`, { timeout: 15_000 }),
        page.getByRole("button", { name: "Войти" }).click(),
      ]);
      failureStage = "browser_edit_open";
      await page.goto(`${base}/admin/products/browser-pump/edit`);
      assert.equal(await page.getByRole("heading", { name: "Редактирование товара" }).count(), 1);
      assert.equal(await page.locator("script").count(), 0);
      assert.equal(await page.locator('input[name="expectedUpdatedAt"]').count(), 1);
      const staleTab = await context.newPage();
      await staleTab.goto(`${base}/admin/products/browser-pump/edit`);
      failureStage = "browser_edit_save";
      assert.equal(await page.locator('input[name="name"]').count(), 1, "browser_product_name_missing");
      await page.locator('input[name="name"]').fill("Browser saved");
      failureStage = "browser_edit_submit";
      const [saveResponse] = await Promise.all([
        page.waitForResponse((response) => response.request().method() === "POST"
          && response.url().endsWith("/admin/products/browser-pump/edit"), { timeout: 15_000 }),
        page.getByRole("button", { name: "Сохранить" }).click(),
      ]);
      assert.equal(saveResponse.status(), 303, "browser_save_status");
      failureStage = "browser_edit_redirect";
      await page.waitForURL(`${base}/admin/products/browser-pump/edit?saved=1`, { timeout: 15_000 });
      assert.match(await page.locator('[role="status"]').textContent(), /Изменения сохранены/);
      failureStage = "browser_edit_database";
      const browserStored = (await rest(`/rest/v1/products?select=name,description&slug=eq.browser-pump`, privateKey)).json[0];
      assert.equal(browserStored.name, "Browser saved", "browser_saved_name");
      assert.equal(browserStored.description, "Browser description", "browser_saved_description");
      failureStage = "browser_edit_conflict";
      await staleTab.locator('input[name="name"]').fill("Stale browser tab");
      const [staleResponse] = await Promise.all([
        staleTab.waitForResponse((response) => response.request().method() === "POST"
          && response.url().endsWith("/admin/products/browser-pump/edit"), { timeout: 15_000 }),
        staleTab.getByRole("button", { name: "Сохранить" }).click(),
      ]);
      assert.equal(staleResponse.status(), 409);
      assert.match(await staleTab.locator('[role="alert"]').textContent(), /Товар изменён/);
      assert.equal((await rest(`/rest/v1/products?select=name&slug=eq.browser-pump`, privateKey)).json[0].name, "Browser saved");
      assert.deepEqual(browserErrors, []);
      await context.close();
    } finally {
      await browser.close();
    }
    checks.push("chromium_no_js_edit_save_and_stale_tab_conflict");

    failureStage = "revocation";
    assert.equal((await rest("/rest/v1/admin_credentials", privateKey, {
      method: "POST", body: JSON.stringify({ credential_key: "primary", password_hash: GOLDEN_PBKDF2_HASH, session_version: 2 }),
    })).status, 201);
    assert.equal((await fetch(`${base}/api/admin/products/edit-pump-renamed`, { headers: { cookie } })).status, 401);
    const revoked = await form(base, fresh.action, fresh.body, cookie);
    assert.equal(revoked.status, 303);
    assert.equal(revoked.headers.get("location"), "/admin/login?session=expired");
    assert.equal((await db()).updated_at, afterSave.updated_at);
    checks.push("revoked_session_reads_and_writes_nothing");
    passed = true;
  } finally {
    for (const worker of workers) await stopWrangler(worker.child).catch(() => { process.exitCode = 1; });
    if (started) {
      try { command("supabase", ["stop", "--project-id", projectId, "--no-backup", "--yes"], "isolated_stack_stop_failed"); }
      catch { process.exitCode = 1; }
    }
    if (safeToRemove(directory)) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      cleanup = true;
    } else process.exitCode = 1;
    console.log(JSON.stringify({ ok: passed && cleanup && process.exitCode !== 1, checks, cleanup }));
  }
}

main().catch((error) => {
  // Only the stage and an assertion label are printed: never keys or bodies.
  const label = error?.code === "ERR_ASSERTION" && typeof error.message === "string" && /^[a-z_]+$/.test(error.message) ? error.message : "assertion";
  console.error(JSON.stringify({ ok: false, code: "local_product_edit_contract_failed", stage: failureStage, label }));
  process.exitCode = 1;
});
