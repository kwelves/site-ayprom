// Proves the Cloudflare R2 write path end to end on the TEST side, before it is ever used with the real bucket:
//   * the admin Worker (real workerd, started locally with `wrangler dev`) saves a brand logo straight to R2,
//   * the background photo worker (Node + Sharp) saves a processed product photo to R2,
// both against the STAGING Supabase project and the TEST bucket `ayprom-media-test`, with receipts in the private
// journal bucket. Everything it creates is removed again. The S3 credentials are derived from the Cloudflare token
// (access key = token id, secret = SHA-256 of the token) and live only in a git-ignored local file and the process
// environment; they are never sent to Cloudflare as Worker secrets and never printed.
// Usage: node scripts/cloudflare/r2-path-smoke.mjs          (needs ~/.ayprom-secrets from the staging setup)
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DeleteObjectsCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { chromium } from "playwright";
import sharp from "sharp";

const ROOT = process.cwd();
const secrets = path.join(os.homedir(), ".ayprom-secrets");
const read = (name) => readFileSync(path.join(secrets, name), "utf8").trim();
const ACCOUNT = "5542d171bab5b5af3202e36e217f6ef9";
const STAGING_URL = "https://jpmoxtqafgbqihvjhvri.supabase.co";
const TEST_BUCKET = "ayprom-media-test";
const JOURNAL_BUCKET = "media-migration-journal";
const MEDIA_BASE = "https://media-test.invalid"; // the test bucket has no public address; only the stored path matters here
const PORT = 8791;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const VARS_FILE = path.join(ROOT, ".dev.vars.r2smoke");

const cloudflareToken = read("cloudflare-token.txt");
const stagingSecret = read("supabase-staging-secret-key.txt");
const adminPassword = read("admin-staging-password.txt");
const verify = await (await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", { headers: { authorization: `Bearer ${cloudflareToken}` } })).json();
if (!verify.success) throw new Error("the Cloudflare token does not verify");
const r2 = { accountId: ACCOUNT, accessKeyId: verify.result.id, secretAccessKey: createHash("sha256").update(cloudflareToken).digest("hex") };
const s3 = new S3Client({ region: "auto", endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey } });
const hidden = [cloudflareToken, stagingSecret, adminPassword, r2.accessKeyId, r2.secretAccessKey];
const hide = (text) => hidden.reduce((value, secret) => value.replaceAll(secret, "[hidden]"), String(text));

const storage = (pathAndQuery, init = {}) => fetch(`${STAGING_URL}/storage/v1/${pathAndQuery}`, {
  ...init, headers: { apikey: stagingSecret, authorization: `Bearer ${stagingSecret}`, "content-type": "application/json", ...init.headers },
  signal: AbortSignal.timeout(30_000) });

const env = {
  NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_yxS4_LQqsdPRtWxxUgg8-g_jQdYsJci",
  SUPABASE_SECRET_KEY: stagingSecret, ADMIN_PASSWORD: adminPassword, ADMIN_SESSION_SECRET: createHash("sha256").update(`r2-smoke-${Date.now()}`).digest("hex"),
  PHOTO_PROCESSING: "queue", NODE_ENV: "production",
  MEDIA_STORAGE_WRITE_TARGET: "r2", MEDIA_STORAGE_JOURNAL_BUCKET: JOURNAL_BUCKET, MEDIA_STORAGE_DUAL_WRITE_SUPABASE: "false", MEDIA_STORAGE_RETAIN_OBJECTS: "true",
  NEXT_PUBLIC_MEDIA_BASE_URL: MEDIA_BASE, R2_ACCOUNT_ID: r2.accountId, R2_ACCESS_KEY_ID: r2.accessKeyId, R2_SECRET_ACCESS_KEY: r2.secretAccessKey, R2_BUCKET_NAME: TEST_BUCKET,
};

const result = { steps: {} };
const created = { r2Keys: new Set(), journalKeys: new Set(), brandSlug: null };
let worker = null;
let runner = null;

// R2 key of a public media URL such as <base>/product-images/<path>
const keyOf = (url) => decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
async function r2Head(key) {
  try { const head = await s3.send(new HeadObjectCommand({ Bucket: TEST_BUCKET, Key: key })); return { size: head.ContentLength, type: head.ContentType, hasSha: Boolean(head.Metadata?.sha256) }; }
  catch (error) { return error.name === "NotFound" ? null : { error: error.name }; }
}
async function listKeys(prefix) {
  const found = [];
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: TEST_BUCKET, Prefix: prefix, ContinuationToken: token }));
    found.push(...(page.Contents ?? []).map((object) => object.Key));
    token = page.NextContinuationToken;
  } while (token);
  return found;
}
async function journalReceipts(prefix) {
  const response = await storage(`object/list/${JOURNAL_BUCKET}`, { method: "POST", body: JSON.stringify({ prefix, limit: 100 }) });
  return response.ok ? (await response.json()).map((item) => `${prefix}/${item.name}`) : [];
}

try {
  // The journal bucket must exist (private) in the project that is tested.
  const buckets = await (await storage("bucket")).json();
  const journal = buckets.find((bucket) => bucket.name === JOURNAL_BUCKET);
  if (!journal) {
    const make = await storage("bucket", { method: "POST", body: JSON.stringify({ id: JOURNAL_BUCKET, name: JOURNAL_BUCKET, public: false }) });
    if (!make.ok) throw new Error(`could not create the journal bucket (${make.status})`);
    result.steps.journalBucket = "created (private)";
  } else if (journal.public) throw new Error("the journal bucket is public: refusing to continue");
  else result.steps.journalBucket = "already there (private)";

  writeFileSync(VARS_FILE, Object.entries(env).map(([name, value]) => `${name}=${value}`).join("\n") + "\n", { mode: 0o600 });
  for (const [script, args] of [[path.join(ROOT, "node_modules/vite/bin/vite.js"), ["build", "--config", "vite.admin-spa.config.ts"]],
    [path.join(ROOT, "scripts/cloudflare/build-admin-static-pages.mjs"), []], [path.join(ROOT, "scripts/cloudflare/build-photo-queue.mjs"), []]]) {
    const built = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, stdio: "ignore", windowsHide: true });
    if (built.status !== 0) throw new Error(`build step failed: ${path.basename(script)}`);
  }

  // The admin Worker, real workerd, local.
  const wrangler = path.join(ROOT, ".wrangler/tools/wrangler-4.135.0/node_modules/wrangler/bin/wrangler.js");
  worker = spawn(process.execPath, [wrangler, "dev", "--config", "wrangler.admin-worker.jsonc", "--env", "r2smoke", "--port", String(PORT), "--ip", "127.0.0.1", "--local"],
    { cwd: ROOT, stdio: "ignore", windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" } });
  for (let i = 0; i < 90; i += 1) {
    if ((await fetch(`${ORIGIN}/api/health`, { signal: AbortSignal.timeout(2000) }).catch(() => null))?.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (i === 89) throw new Error("the local admin Worker did not start");
  }

  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const rpc = (name, ...args) => page.evaluate(async ([action, input]) => {
    const response = await fetch(`/api/admin/rpc/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ args: input }) });
    return { status: response.status, value: (await response.json()).value };
  }, [name, args]);
  try {
    await page.goto(`${ORIGIN}/admin/login`);
    await page.getByLabel("Пароль").fill(adminPassword);
    await page.getByRole("button", { name: /Войти/ }).click();
    await page.waitForURL(/\/admin\/(welcome|products)/, { timeout: 30_000 });

    // ---- Part A: a brand logo written by the Worker itself ----
    const stamp = Date.now().toString(36);
    const logo = await sharp({ create: { width: 240, height: 120, channels: 3, background: { r: 20, g: 80, b: 160 } } }).png().toBuffer();
    await page.goto(`${ORIGIN}/admin/brands/new`, { waitUntil: "load" });
    await page.getByLabel("Название").fill(`R2 smoke ${stamp}`);
    await page.getByLabel("Страна").fill("XX");
    await page.locator('input[type="file"][name="logo"]').setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: logo });
    await page.getByRole("button", { name: /Создать/ }).click();
    await page.waitForURL(/\/admin\/brands(\?.*)?$/, { timeout: 60_000 });
    const brand = (await rpc("getBrands")).value.find((item) => item.name === `R2 smoke ${stamp}`);
    created.brandSlug = brand?.slug ?? null;
    const logoKey = brand ? keyOf(brand.logo) : null;
    if (logoKey) created.r2Keys.add(logoKey);
    const head = logoKey ? await r2Head(logoKey) : null;
    const receipts = logoKey ? await journalReceipts(logoKey) : [];
    receipts.forEach((key) => created.journalKeys.add(key));
    result.steps.workerLogo = { brandCreated: Boolean(brand), urlUsesMediaBase: brand?.logo?.startsWith(`${MEDIA_BASE}/`) ?? false, key: logoKey?.replace(stamp, "<id>"), objectInR2: head, journalReceipts: receipts.length };
  } finally { await browser.close(); }

  // ---- Part B: a processed product photo written by the background worker (Node + Sharp) ----
  runner = spawn(process.execPath, [path.join(ROOT, "deploy/photo-queue/runner.mjs"), "--watch"], { cwd: ROOT, stdio: "ignore", windowsHide: true, env: { ...process.env, ...env } });
  const before = new Set(await listKeys("product-images/"));
  const photo = spawnSync(process.execPath, [path.join(ROOT, "scripts/cloudflare/admin-photo-smoke.mjs"), ORIGIN], {
    cwd: ROOT, encoding: "utf8", windowsHide: true, timeout: 300_000, env: { ...process.env, ADMIN_PASSWORD: adminPassword } });
  let photoReport = null;
  try { photoReport = JSON.parse(photo.stdout.slice(photo.stdout.indexOf("{"))); } catch { photoReport = { error: hide(`${photo.stdout}${photo.stderr}`).slice(-300) }; }
  const added = (await listKeys("product-images/")).filter((key) => !before.has(key));
  added.forEach((key) => created.r2Keys.add(key));
  for (const key of added) (await journalReceipts(key)).forEach((receipt) => created.journalKeys.add(receipt));
  result.steps.photoWorker = { smokeReport: photoReport, newObjectsInR2: added.length, newObjects: await Promise.all(added.slice(0, 4).map(async (key) => ({ key: key.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<uuid>"), ...(await r2Head(key)) }))), journalReceipts: created.journalKeys.size - (result.steps.workerLogo?.journalReceipts ?? 0) };
} catch (error) {
  result.error = hide(error?.message ?? error).slice(0, 400);
} finally {
  worker?.kill();
  runner?.kill();
  rmSync(VARS_FILE, { force: true });
  // Clean-up: brand (database), test objects (R2), receipts (journal).
  try {
    if (created.brandSlug) {
      // The Worker is already stopped: remove the brand with the service key straight from the database.
      await fetch(`${STAGING_URL}/rest/v1/brands?slug=eq.${encodeURIComponent(created.brandSlug)}`, { method: "DELETE", headers: { apikey: stagingSecret, authorization: `Bearer ${stagingSecret}` } });
    }
    if (created.r2Keys.size) await s3.send(new DeleteObjectsCommand({ Bucket: TEST_BUCKET, Delete: { Objects: [...created.r2Keys].map((Key) => ({ Key })), Quiet: true } }));
    if (created.journalKeys.size) await storage(`object/${JOURNAL_BUCKET}`, { method: "DELETE", body: JSON.stringify({ prefixes: [...created.journalKeys] }) });
    result.cleanup = { brandRemoved: Boolean(created.brandSlug), r2ObjectsRemoved: created.r2Keys.size, receiptsRemoved: created.journalKeys.size, r2LeftOver: (await listKeys("")).length };
  } catch (error) { result.cleanup = { error: hide(error?.message ?? error).slice(0, 200) }; }
}
console.log(hide(JSON.stringify(result, null, 2)));
