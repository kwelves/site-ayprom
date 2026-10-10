// Exercise the catalog snapshot against an isolated PostgREST with max_rows=2.
// No production endpoints, shared Supabase changes, package promotion, or deploy.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, lstatSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertPortsFree, command, createIsolatedProject } from "./local-admin-auth-smoke.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PREFIX = "ayprom-snapshot-cap-";
register("./static-producer-loader.mjs", { parentURL: import.meta.url, data: { srcRoot: path.join(ROOT, "src") } });
const { loadLocalCatalogSnapshot } = await import(pathToFileURL(
  path.join(ROOT, "src/cloudflare/static-build/producer/local-snapshot.ts"),
).href);

function safeToRemove(directory) {
  const canonical = realpathSync(directory);
  return path.dirname(canonical) === realpathSync(os.tmpdir())
    && path.basename(canonical).startsWith(PREFIX)
    && canonical === path.resolve(directory)
    && lstatSync(directory).isDirectory()
    && !lstatSync(directory).isSymbolicLink();
}

async function main() {
  await assertPortsFree();
  const directory = mkdtempSync(path.join(os.tmpdir(), PREFIX));
  const projectId = `ayprom-snapshot-${randomBytes(5).toString("hex")}`;
  let started = false;
  let cleanup = false;
  let passed = false;
  let productOffsets = [];
  try {
    createIsolatedProject(directory, projectId);
    const configPath = path.join(directory, "supabase/config.toml");
    const config = readFileSync(configPath, "utf8");
    assert.match(config, /^max_rows = 1000$/m);
    writeFileSync(configPath, config.replace(/^max_rows = 1000$/m, "max_rows = 2"), { mode: 0o600 });
    started = true;
    command("supabase", ["start", "--workdir", directory,
      "--exclude", "studio,realtime,storage-api,imgproxy,postgres-meta,mailpit,edge-runtime,logflare,vector,supavisor",
      "--yes"], "isolated_stack_start_failed");
    const status = JSON.parse(command("supabase", ["status", "--workdir", directory, "--output", "json"], "isolated_status_failed"));
    assert.equal(status.API_URL, "http://127.0.0.1:56421");
    const publicKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
    const privateKey = status.SERVICE_ROLE_KEY;
    assert.ok(publicKey && privateKey);
    const privateHeaders = { apikey: privateKey, "content-type": "application/json" };
    if (privateKey.startsWith("eyJ")) privateHeaders.authorization = `Bearer ${privateKey}`;
    const category = await fetch(`${status.API_URL}/rest/v1/categories`, {
      method: "POST", headers: privateHeaders,
      body: JSON.stringify({ slug: "snapshot-cap", name: "Snapshot cap", description: "Local test", icon: "gear", image: "" }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(category.status, 201);
    const products = await fetch(`${status.API_URL}/rest/v1/products`, {
      method: "POST", headers: privateHeaders,
      body: JSON.stringify(Array.from({ length: 5 }, (_, index) => ({
        slug: `snapshot-cap-${index + 1}`, name: `Snapshot cap ${index + 1}`,
        category_slug: "snapshot-cap", short_description: "Local test only",
        published: true, order: index,
      }))),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(products.status, 201);

    const firstPage = await fetch(`${status.API_URL}/rest/v1/products?select=slug&order=slug.asc&limit=1000&offset=0`, {
      headers: { apikey: publicKey, Authorization: `Bearer ${publicKey}`, Prefer: "count=exact" },
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(firstPage.ok, true);
    assert.equal(firstPage.headers.get("content-range"), "0-1/5");
    assert.equal((await firstPage.json()).length, 2);

    productOffsets = [];
    const snapshot = await loadLocalCatalogSnapshot({
      url: status.API_URL,
      key: publicKey,
      fetchImpl: async (input, init) => {
        const requestUrl = new URL(String(input));
        assert.equal(requestUrl.origin, status.API_URL);
        assert.equal(new Headers(init?.headers).get("apikey"), publicKey);
        if (requestUrl.pathname === "/rest/v1/products") {
          productOffsets.push(Number(requestUrl.searchParams.get("offset")));
        }
        return fetch(input, init);
      },
    });
    assert.equal(snapshot.products.length, 5);
    assert.deepEqual(productOffsets, [0, 2, 4]);
    passed = true;
  } finally {
    if (started) {
      try { command("supabase", ["stop", "--project-id", projectId, "--no-backup", "--yes"], "isolated_stack_stop_failed"); }
      catch { process.exitCode = 1; }
    }
    if (safeToRemove(directory)) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      cleanup = true;
    } else process.exitCode = 1;
    console.log(JSON.stringify({ ok: passed && cleanup && process.exitCode !== 1, maxRows: 2, products: passed ? 5 : null,
      productOffsets, cleanup }));
  }
}

main().catch(() => {
  console.error(JSON.stringify({ ok: false, failure: "snapshot_cap_smoke_failed" }));
  process.exitCode = 1;
});
