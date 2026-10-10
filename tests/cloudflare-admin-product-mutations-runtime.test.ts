import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createSessionCodec } from "@/lib/admin/session-codec";
import { startWrangler, stopWrangler } from "../scripts/cloudflare/local-admin-auth-smoke.mjs";

const key = "sb_secret_fake13";
const secret = "local-handler-runtime-cookie-secret-32-bytes";
const id = "4d331dcf-4243-4a29-aacd-93c30af433e6";
const fields = {
  slugBase: "test-pump", name: "Test pump", categorySlug: "hydraulic-pumps", subcategorySlug: null,
  shortDescription: "", description: null, article: null, published: false,
  availability: "in_stock", metaTitle: null, metaDescription: null,
  characteristics: [], compatibleBrands: [], vehicleTypes: [],
};

it("protects real product RPC ports inside local workerd and sanitizes stale edits", async () => {
  const paths: string[] = [];
  let stale = false;
  const backend = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://local").pathname;
    paths.push(pathname);
    const headers = { "content-type": "application/json" };
    if (request.headers.apikey !== key) { response.writeHead(403, headers); response.end("{}"); return; }
    if (pathname.endsWith("create_product_with_relations")) {
      response.writeHead(200, headers); response.end(JSON.stringify([{ out_id: id, out_slug: "test-pump" }])); return;
    }
    if (pathname.endsWith("update_product_with_slug")) {
      response.writeHead(stale ? 500 : 200, headers);
      response.end(stale ? JSON.stringify({ code: "55000", message: key })
        : JSON.stringify([{ out_id: id, out_updated_at: "2026-10-04T09:00:00Z" }]));
      return;
    }
    response.writeHead(404, headers); response.end("{}");
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const address = backend.address();
  if (!address || typeof address === "string") throw new Error("backend address");
  const directory = mkdtempSync(path.join(tmpdir(), "ayprom-protected-product-runtime-"));
  const config = path.join(directory, "wrangler.json");
  writeFileSync(config, JSON.stringify({
    name: "ayprom-protected-product-runtime-test",
    main: path.resolve("tests/support/product-mutation-handler-runtime-entry.ts"),
    compatibility_date: "2026-09-19", compatibility_flags: ["nodejs_compat"],
    vars: { SUPABASE_URL: `http://127.0.0.1:${address.port}`, ADMIN_SUPABASE_KEY: key, ADMIN_COOKIE_HMAC_KEY: secret },
  }));
  let running;
  try {
    running = await startWrangler(config, directory);
    const token = await createSessionCodec(secret, Date.now).create({ credentialVersion: 1 });
    const createBody = JSON.stringify(fields);
    const guest = await fetch(`${running.base}/api/admin/products`, {
      method: "POST", headers: { origin: running.base, "content-type": "application/json" }, body: createBody,
    });
    expect(guest.status).toBe(401);
    expect(paths).toEqual([]);
    const foreign = await fetch(`${running.base}/api/admin/products`, {
      method: "POST", headers: { origin: "https://attacker.example", cookie: `admin_session=${token}`, "content-type": "application/json" }, body: createBody,
    });
    expect(foreign.status).toBe(400);
    expect(paths).toEqual([]);
    const created = await fetch(`${running.base}/api/admin/products`, {
      method: "POST", headers: { origin: running.base, cookie: `admin_session=${token}`, "content-type": "application/json" }, body: createBody,
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id, slug: "test-pump" });
    expect(paths).toEqual(["/rest/v1/rpc/create_product_with_relations"]);
    stale = true;
    const updated = await fetch(`${running.base}/api/admin/products/test-pump`, {
      method: "PUT", headers: { origin: running.base, cookie: `admin_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ newSlug: "new-pump", expectedUpdatedAt: "2026-10-04T08:00:00Z", fields }),
    });
    expect(updated.status).toBe(409);
    expect(await updated.clone().json()).toEqual({ error: "conflict" });
    expect(paths).toEqual(["/rest/v1/rpc/create_product_with_relations", "/rest/v1/rpc/update_product_with_slug"]);
    expect(await updated.text()).not.toContain(key);
  } finally {
    await stopWrangler(running?.child);
    backend.closeAllConnections();
    await new Promise<void>((resolve) => backend.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}, 90_000);
