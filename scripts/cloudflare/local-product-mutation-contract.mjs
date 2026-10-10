// Real local PostgREST contract for the private Cloudflare product mutation
// ports. Uses a fresh isolated Supabase project; never touches the shared DB.
// Run: node --experimental-transform-types scripts/cloudflare/local-product-mutation-contract.mjs
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertPortsFree, command, createIsolatedProject } from "./local-admin-auth-smoke.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PREFIX = "ayprom-product-mutation-contract-";
let failureStage = "setup";
register("./static-producer-loader.mjs", { parentURL: import.meta.url, data: { srcRoot: path.join(ROOT, "src") } });
const { createAdminProductMutationPorts, AdminProductMutationError } = await import(pathToFileURL(
  path.join(ROOT, "src/cloudflare/admin/product-mutation-ports.ts"),
).href);

function safeToRemove(directory) {
  const canonical = realpathSync(directory);
  return path.dirname(canonical) === realpathSync(os.tmpdir())
    && path.basename(canonical).startsWith(PREFIX)
    && canonical === path.resolve(directory)
    && lstatSync(directory).isDirectory()
    && !lstatSync(directory).isSymbolicLink();
}

function privateHeaders(key) {
  const headers = { apikey: key, "content-type": "application/json" };
  if (key.startsWith("eyJ")) headers.authorization = `Bearer ${key}`;
  return headers;
}

async function rows(url, key) {
  const response = await fetch(url, { headers: privateHeaders(key), signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200, "private_read_failed");
  return response.json();
}

async function main() {
  await assertPortsFree();
  const directory = mkdtempSync(path.join(os.tmpdir(), PREFIX));
  const projectId = `ayprom-product-mutation-${randomBytes(5).toString("hex")}`;
  const checks = [];
  let started = false;
  let cleanup = false;
  let passed = false;
  try {
    failureStage = "isolated_stack_start";
    createIsolatedProject(directory, projectId);
    started = true;
    command("supabase", ["start", "--workdir", directory,
      "--exclude", "studio,realtime,storage-api,imgproxy,postgres-meta,mailpit,edge-runtime,logflare,vector,supavisor",
      "--yes"], "isolated_stack_start_failed");
    checks.push("fresh_migrations_applied");

    const status = JSON.parse(command("supabase", ["status", "--workdir", directory, "--output", "json"], "isolated_status_failed"));
    assert.equal(status.API_URL, "http://127.0.0.1:56421");
    const privateKey = status.SERVICE_ROLE_KEY;
    const publicKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
    assert.ok(privateKey && publicKey, "isolated_keys_missing");
    const api = status.API_URL;

    const category = await fetch(`${api}/rest/v1/categories`, {
      method: "POST", headers: privateHeaders(privateKey),
      body: JSON.stringify({ slug: "contract-pumps", name: "Contract pumps", description: "Local test only", icon: "gear", image: "" }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(category.status, 201, "category_fixture_failed");

    const fields = {
      slugBase: "contract-pump", name: "Contract pump", categorySlug: "contract-pumps", subcategorySlug: null,
      shortDescription: "Local test only", description: "Before update", article: "CONTRACT-1", published: false,
      availability: "in_stock", metaTitle: null, metaDescription: null,
      characteristics: [{ attribute: "Pressure", value: "200 bar" }], compatibleBrands: [], vehicleTypes: [],
    };
    let lastRpcFailure = "none";
    const diagnosticFetch = async (url, init) => {
      const response = await fetch(url, init);
      if (!response.ok && String(url).includes("/rest/v1/rpc/update_product_with_slug")) {
        let code = "unknown";
        try {
          const payload = await response.clone().json();
          if (typeof payload?.code === "string" && /^[A-Z0-9]{4,10}$/.test(payload.code)) code = payload.code;
        } catch { /* only a bounded, non-secret status code is retained */ }
        lastRpcFailure = `${response.status}_${code}`;
      }
      return response;
    };
    const ports = createAdminProductMutationPorts({ SUPABASE_URL: api, ADMIN_SUPABASE_KEY: privateKey }, diagnosticFetch);
    failureStage = "private_create";
    const created = await ports.create(fields);
    assert.match(created.id, /^[0-9a-f-]{36}$/i);
    assert.equal(created.slug, "contract-pump");
    const before = await rows(`${api}/rest/v1/products?select=id,slug,name,published,updated_at&id=eq.${created.id}`, privateKey);
    assert.equal(before.length, 1);
    assert.equal(before[0].published, false);
    assert.equal(before[0].name, fields.name);
    checks.push("private_create_and_database_row");

    const publicCreate = await fetch(`${api}/rest/v1/rpc/create_product_with_relations`, {
      method: "POST", headers: { apikey: publicKey, "content-type": "application/json" },
      body: JSON.stringify({ p_slug_base: "forbidden-public", p_name: "Forbidden", p_category_slug: "contract-pumps" }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(publicCreate.ok, false, "public_mutation_was_allowed");
    assert.equal((await rows(`${api}/rest/v1/products?select=id&slug=eq.forbidden-public`, privateKey)).length, 0);
    checks.push("public_create_denied");

    const changedFields = { ...fields, name: "Contract pump updated", description: "After update", published: true };
    failureStage = "private_update";
    const updated = await ports.update({
      slug: created.slug, newSlug: "contract-pump-updated", expectedUpdatedAt: before[0].updated_at, fields: changedFields,
    });
    assert.equal(updated.id, created.id);
    const after = await rows(`${api}/rest/v1/products?select=id,slug,name,published,updated_at&id=eq.${created.id}`, privateKey);
    assert.equal(after.length, 1);
    assert.equal(after[0].slug, "contract-pump-updated");
    assert.equal(after[0].name, changedFields.name);
    assert.equal(after[0].published, true);
    assert.equal(after[0].updated_at, updated.updatedAt);
    checks.push("atomic_update_rename_and_publish");

    failureStage = "stale_update";
    let staleOutcome = "unexpected_success";
    try {
      await ports.update({ slug: "contract-pump-updated", newSlug: "should-not-win", expectedUpdatedAt: before[0].updated_at, fields });
    } catch (error) {
      staleOutcome = error instanceof AdminProductMutationError ? error.code : "unexpected_exception";
    }
    failureStage = `stale_update_${staleOutcome}_${lastRpcFailure}`;
    assert.equal(staleOutcome, "conflict", "stale_update_was_not_rejected");
    const unchanged = await rows(`${api}/rest/v1/products?select=slug,name,published&id=eq.${created.id}`, privateKey);
    assert.equal(unchanged[0].slug, "contract-pump-updated");
    assert.equal(unchanged[0].name, changedFields.name);
    checks.push("stale_update_rejected_without_partial_write");
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
    console.log(JSON.stringify({ ok: passed && cleanup && process.exitCode !== 1, checks, cleanup }));
  }
}

main().catch(() => {
  console.error(JSON.stringify({ ok: false, code: "local_product_mutation_contract_failed", stage: failureStage }));
  process.exitCode = 1;
});
