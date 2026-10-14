// End-to-end check of the background photo queue on the STAGING admin: add one photo to a product through the
// real form, time how long it takes to appear, then remove it again.
// Usage: node scripts/cloudflare/admin-photo-smoke.mjs [origin]    Password: env ADMIN_PASSWORD or the staging password file.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { chromium } from "playwright";

const ORIGIN = (process.argv.find((arg) => arg.startsWith("http")) ?? "https://ayprom-admin-staging.ayprom-migration.workers.dev").replace(/\/$/, "");
const password = process.env.ADMIN_PASSWORD ?? readFileSync(path.join(os.homedir(), ".ayprom-secrets", "admin-staging-password.txt"), "utf8").trim();

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const out = { origin: ORIGIN };
const rpc = (name, ...args) => page.evaluate(async ([action, input]) => {
  const response = await fetch(`/api/admin/rpc/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ args: input }) });
  return { status: response.status, value: (await response.json()).value };
}, [name, args]);

await page.goto(`${ORIGIN}/admin/login`);
await page.getByLabel("Пароль").fill(password);
await page.getByRole("button", { name: /Войти/ }).click();
await page.waitForURL(/\/admin\/(welcome|products)/);

const list = (await rpc("getAdminProducts", {})).value;
const target = list.items[0];
out.product = target.slug;
const before = (await rpc("getAdminProduct", target.slug)).value;
const imagesBefore = before.images.length;

const raw = Buffer.alloc(1600 * 1200 * 3);
for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 13 + (i >> 8)) & 255;
const photo = await sharp(raw, { raw: { width: 1600, height: 1200, channels: 3 } }).jpeg({ quality: 82 }).toBuffer();

await page.goto(`${ORIGIN}/admin/products/${target.slug}/edit`, { waitUntil: "load" });
await page.getByRole("button", { name: /Фотографии/ }).click();
const started = Date.now();
await page.locator('input[type="file"]').first().setInputFiles({ name: "queue-test.jpg", mimeType: "image/jpeg", buffer: photo });
await page.getByRole("status").filter({ hasText: "Обрабатывается фото" }).waitFor({ timeout: 30_000 });
out.secondsUntilPendingNotice = Math.round((Date.now() - started) / 100) / 10;

// The form follows the queue by itself: wait until the photo joins the list.
let appeared = false;
while (Date.now() - started < 240_000) {
  const now = (await rpc("getAdminProduct", target.slug)).value;
  if (now.images.length > imagesBefore) { appeared = true; break; }
  await page.waitForTimeout(3000);
}
out.photoAppeared = appeared;
out.secondsUntilPhotoReady = Math.round((Date.now() - started) / 100) / 10;
if (appeared) {
  await page.getByRole("status").filter({ hasText: "Обрабатывается фото" }).waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
  out.noticeGone = (await page.getByRole("status").filter({ hasText: "Обрабатывается фото" }).count()) === 0;
  const after = (await rpc("getAdminProduct", target.slug)).value;
  const added = after.images.find((image) => !before.images.some((old) => old.id === image.id));
  out.variantsCreated = Boolean(added && added.previewUrl && added.previewUrl !== added.url);
  if (added) out.cleanup = (await rpc("deleteProductImage", added.id)).status;
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
process.exitCode = out.photoAppeared ? 0 : 1;
