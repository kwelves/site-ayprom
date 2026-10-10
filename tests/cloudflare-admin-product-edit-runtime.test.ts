import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createSessionCodec } from "@/lib/admin/session-codec";
import { startWrangler, stopWrangler } from "../scripts/cloudflare/local-admin-auth-smoke.mjs";
import { GOLDEN_PBKDF2_HASH } from "./support/legacy-password-verifier-fixtures";
import { injectedMarkup, submitEditForm } from "./support/no-js-form";

const key = "sb_secret_fake10";
const secret = "local-product-edit-runtime-cookie-secret-32";
const id = "4d331dcf-4243-4a29-aacd-93c30af433e6";
const storedAt = "2026-10-04T08:00:00.123456+00:00";
const row = {
  id, slug: "pump", name: '"><script>alert(1)</script>', category_slug: "hydraulic-pumps",
  short_description: "Short", description: "</textarea><img src=x onerror=alert(2)>", article: "A-1",
  published: true, availability: "in_stock", meta_title: null, meta_description: null, updated_at: storedAt,
  subcategories: { slug: "gear" }, product_characteristics: [{ attribute: "Pressure", value: "200 bar", order: 1 }],
  product_brands: [{ brand_slug: "howo" }], product_vehicle_types: [], vehicle_hotspots: [],
};

type Mode = "ok" | "oversized" | "error" | "redirect" | "broken";

it("serves the protected product read and no-JS edit flow inside real workerd", async () => {
  const calls: { path: string; method: string; key: string | undefined; body: string }[] = [];
  let mode: Mode = "ok";
  let credentialRows: unknown[] = [];
  let stale = false;
  const backend = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://local").pathname;
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      calls.push({ path: pathname, method: request.method ?? "", key: request.headers.apikey as string | undefined, body });
      const json = (status: number, payload: unknown) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(payload)); };
      if (request.headers.apikey !== key) return json(403, {});
      if (pathname === "/rest/v1/admin_credentials") return json(200, credentialRows);
      if (pathname === "/rest/v1/products") {
        if (mode === "oversized") return json(200, [{ ...row, description: "x".repeat(70_000) }]);
        if (mode === "error") return json(500, { code: "XX000", message: `relation products ${key}` });
        if (mode === "redirect") { response.writeHead(302, { location: "/credential-sink" }); return response.end(); }
        if (mode === "broken") { response.writeHead(200, { "content-type": "application/json" }); return response.end("[{"); }
        return json(200, [row]);
      }
      if (pathname === "/rest/v1/rpc/update_product_with_slug") {
        return stale ? json(500, { code: "55000", message: `stale ${key}` }) : json(200, [{ out_id: id, out_updated_at: "2026-10-04T09:00:00.654321+00:00" }]);
      }
      json(404, {});
    });
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const address = backend.address();
  if (!address || typeof address === "string") throw new Error("backend address");
  const directory = mkdtempSync(path.join(tmpdir(), "ayprom-product-edit-runtime-"));
  const config = path.join(directory, "wrangler.json");
  writeFileSync(config, JSON.stringify({
    name: "ayprom-product-edit-runtime-test",
    main: path.resolve("tests/support/product-edit-runtime-entry.ts"),
    compatibility_date: "2026-09-19", compatibility_flags: ["nodejs_compat"],
    vars: { SUPABASE_URL: `http://127.0.0.1:${address.port}`, ADMIN_SUPABASE_KEY: key, ADMIN_COOKIE_HMAC_KEY: secret },
  }));
  let running;
  try {
    running = await startWrangler(config, directory);
    const base = running.base;
    const cookie = `admin_session=${await createSessionCodec(secret, Date.now).create({ credentialVersion: 1 })}`;
    const productCalls = () => calls.filter((call) => call.path === "/rest/v1/products").length;
    const rpcCalls = () => calls.filter((call) => call.path.startsWith("/rest/v1/rpc/"));

    // Guests never reach the draft.
    expect((await fetch(`${base}/api/admin/products/pump`)).status).toBe(401);
    const guestPage = await fetch(`${base}/admin/products/pump/edit`, { redirect: "manual" });
    expect(guestPage.status).toBe(302);
    expect(productCalls()).toBe(0);

    // Current session: exact JSON contract, then the escaped HTML form.
    const read = await fetch(`${base}/api/admin/products/pump`, { headers: { cookie } });
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("no-store");
    const detail = await read.json();
    expect(detail).toMatchObject({ slug: "pump", updatedAt: storedAt, name: row.name, compatibleBrands: ["howo"] });
    const page = await fetch(`${base}/admin/products/pump/edit`, { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).not.toContain("script-src");
    const html = await page.text();
    expect(injectedMarkup(html)).toEqual([]);
    const form = submitEditForm(html);
    expect(form.body.get("expectedUpdatedAt")).toBe(storedAt);

    // Foreign Origin: no write.
    const foreign = await fetch(`${base}${form.action}`, {
      method: "POST", redirect: "manual", body: form.body,
      headers: { origin: "https://attacker.example", cookie, "content-type": "application/x-www-form-urlencoded" },
    });
    expect(foreign.status).toBe(400);
    expect(rpcCalls()).toEqual([]);

    // Unchanged save: one CAS RPC with the verbatim timestamp and the same relations.
    form.body.set("name", "Renamed pump");
    const saved = await fetch(`${base}${form.action}`, {
      method: "POST", redirect: "manual", body: form.body,
      headers: { origin: base, cookie, "content-type": "application/x-www-form-urlencoded" },
    });
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/admin/products/pump/edit?saved=1");
    expect(rpcCalls()).toHaveLength(1);
    expect(JSON.parse(rpcCalls()[0].body)).toMatchObject({
      p_slug: "pump", p_new_slug: "pump", p_expected_updated_at: storedAt, p_name: "Renamed pump",
      p_description: row.description, p_subcategory_slug: "gear", p_compatible_brands: ["howo"],
      p_characteristics: [{ attribute: "Pressure", value: "200 bar" }],
    });

    // A stale tab gets a readable 409 page; the backend text never leaks.
    stale = true;
    const conflict = await fetch(`${base}${form.action}`, {
      method: "POST", redirect: "manual", body: form.body,
      headers: { origin: base, cookie, "content-type": "application/x-www-form-urlencoded" },
    });
    expect(conflict.status).toBe(409);
    const conflictHtml = await conflict.text();
    expect(conflictHtml).toContain("Товар изменён");
    expect(conflictHtml).not.toContain(key);

    // Broken, oversized, failing or redirecting backend answers fail closed.
    for (const failure of ["oversized", "error", "redirect", "broken"] as const) {
      mode = failure;
      const api = await fetch(`${base}/api/admin/products/pump`, { headers: { cookie } });
      expect(api.status, failure).toBe(503);
      const apiText = await api.text();
      expect(apiText).not.toContain(key);
      expect(apiText).not.toContain("relation");
      const htmlPage = await fetch(`${base}/admin/products/pump/edit`, { headers: { cookie } });
      expect(htmlPage.status, failure).toBe(503);
    }
    expect(calls.some((call) => call.path === "/credential-sink")).toBe(false);
    mode = "ok";

    // Password changed elsewhere: the old cookie reads and writes nothing.
    credentialRows = [{ password_hash: GOLDEN_PBKDF2_HASH, session_version: 2 }];
    const before = { products: productCalls(), rpc: rpcCalls().length };
    expect((await fetch(`${base}/api/admin/products/pump`, { headers: { cookie } })).status).toBe(401);
    const revokedSave = await fetch(`${base}${form.action}`, {
      method: "POST", redirect: "manual", body: form.body,
      headers: { origin: base, cookie, "content-type": "application/x-www-form-urlencoded" },
    });
    expect(revokedSave.status).toBe(303);
    expect(revokedSave.headers.get("location")).toBe("/admin/login?session=expired");
    expect({ products: productCalls(), rpc: rpcCalls().length }).toEqual(before);
  } finally {
    await stopWrangler(running?.child);
    backend.closeAllConnections();
    await new Promise<void>((resolve) => backend.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}, 120_000);
