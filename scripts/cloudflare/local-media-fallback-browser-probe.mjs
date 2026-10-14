/** Browser-only fault probe. No Supabase, Cloudflare, production media or account access. */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = path.join(repo, "fixtures/cloudflare-media-fallback");
const jpeg = await readFile(path.join(repo, "tests/e2e/fixtures/product-photo.jpg"));
const server = await createServer({
  root: fixture, appType: "spa", logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
  resolve: { alias: [
    { find: "next/image", replacement: path.join(fixture, "next-image-stub.tsx") },
    { find: "@", replacement: path.join(repo, "src") },
  ] },
});
let browser;
try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("probe_server_not_ready");
  const base = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const requests = [];
  const pageErrors = [];
  page.on("pageerror", () => pageErrors.push("page_error"));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === "/variant.webp" || url.pathname === "/missing-master.jpg") {
      requests.push({ path: url.pathname, status: 404 });
      return route.fulfill({ status: 404, contentType: "text/plain", body: "" });
    }
    if (url.pathname === "/master.jpg") {
      requests.push({ path: url.pathname, status: 200 });
      return route.fulfill({ status: 200, contentType: "image/jpeg", body: jpeg });
    }
    return route.continue();
  });

  await page.goto(base + "/?master=ok");
  await page.locator('body[data-ready="1"]').waitFor();
  const image = page.getByRole("img", { name: "Probe product" });
  assert.equal(new URL(await image.getAttribute("src"), base).pathname, "/master.jpg");
  assert.equal(await image.evaluate((element) => element.naturalWidth > 0), true);
  assert.equal(await page.locator("body").getAttribute("data-failed"), null);
  assert.deepEqual(requests, [{ path: "/variant.webp", status: 404 }, { path: "/master.jpg", status: 200 }]);

  requests.length = 0;
  await page.goto(base + "/?master=missing");
  await page.locator('body[data-failed="1"]').waitFor();
  await page.getByRole("img", { name: "Probe product. Фотография пока не добавлена" }).waitFor();
  assert.equal(await page.locator("body").getAttribute("data-ready"), null);
  assert.deepEqual(requests, [{ path: "/variant.webp", status: 404 }, { path: "/missing-master.jpg", status: 404 }]);
  assert.deepEqual(pageErrors, []);
  process.stdout.write(JSON.stringify({ ok: true, checks: ["variant_404_master_200", "variant_404_master_404"], browser: browser.version() }) + "\n");
} finally {
  await browser?.close();
  await server.close();
}
