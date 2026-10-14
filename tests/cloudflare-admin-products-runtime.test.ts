import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { startWrangler, stopWrangler } from "../scripts/cloudflare/local-admin-auth-smoke.mjs";
import { createSessionCodec } from "@/lib/admin/session-codec";
import { GOLDEN_PBKDF2_HASH } from "./support/legacy-password-verifier-fixtures";

it("reads protected products inside real workerd, not only Node fetch", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ayprom-products-runtime-"));
  const secret = "local-only-products-workerd-test-secret";
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(new URL(req.url!, "http://local").pathname);
    if (req.url?.startsWith("/rest/v1/admin_credentials")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([{ password_hash: GOLDEN_PBKDF2_HASH, session_version: 2 }]));
    } else if (req.url?.startsWith("/rest/v1/products?")) {
      if (req.url.includes("redirect-probe")) { res.writeHead(302, { location: "/credential-sink" }); res.end(); return; }
      res.writeHead(206, { "content-type": "application/json", "content-range": "0-0/1" });
      res.end(JSON.stringify([{ id: "p1", slug: "draft", name: "Draft", article: null, published: false }]));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  const config = path.join(directory, "wrangler.json");
  writeFileSync(config, JSON.stringify({
    name: "ayprom-products-runtime-test", main: path.resolve("src/cloudflare/worker.ts"), compatibility_date: "2026-09-19", compatibility_flags: ["nodejs_compat"],
    assets: { directory: path.resolve("fixtures/cloudflare-admin-assets"), binding: "ASSETS", run_worker_first: ["/api/*", "/admin", "/admin/*"] },
    vars: { SUPABASE_URL: `http://127.0.0.1:${address.port}`, SUPABASE_PUBLISHABLE_KEY: "test-public", ADMIN_SUPABASE_KEY: "test-private", ADMIN_COOKIE_HMAC_KEY: secret, ADMIN_CRYPTO_KEY: "local-only-products-runtime-crypto-secret-123456" },
  }));
  let running;
  try {
    running = await startWrangler(config, directory);
    const token = await createSessionCodec(secret, Date.now).create({ credentialVersion: 2 });
    const response = await fetch(`${running.base}/api/admin/products`, { headers: { cookie: `admin_session=${token}` } });
    if (response.status !== 200) await new Promise((resolve) => setTimeout(resolve, 500));
    expect(response.status, `${JSON.stringify(paths)} ${await response.clone().text()} ${running.productStages()}`).toBe(200);
    expect((await response.json()).items[0].published).toBe(false);
    const redirected = await fetch(`${running.base}/api/admin/products?q=redirect-probe`, { headers: { cookie: `admin_session=${token}` } });
    expect(redirected.status).toBe(503);
    expect(paths).not.toContain("/credential-sink");
  } finally {
    await stopWrangler(running?.child);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}, 90_000);
