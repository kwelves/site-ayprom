// Isolated PostgreSQL checks. No remote project, shared stack or storage writes.
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, lstatSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { assertPortsFree, command, createIsolatedProject } from "./local-admin-auth-smoke.mjs";
import { processProductPhoto } from "../../src/cloudflare/media/product-photo-processor.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PREFIX = "ayprom-media-jobs-";
const schemaMode = process.argv.slice(2).join(" ") === "--schema";
if (process.argv.length > 2 && !schemaMode) throw new Error("invalid_arguments");
await assertPortsFree();
const directory = mkdtempSync(path.join(os.tmpdir(), PREFIX));
const projectId = `ayprom-media-${randomBytes(5).toString("hex")}`;
let started = false;
let ok = false;
try {
  createIsolatedProject(directory, projectId);
  started = true;
  command("supabase", ["start", "--workdir", directory, "--exclude", "studio,realtime,storage-api,imgproxy,postgres-meta,mailpit,edge-runtime,logflare,vector,supavisor", "--yes"], "isolated_start_failed");
  // Diagnostic application of the desired declarative source, before migration
  // generation. Default mode always tests the actual migration history instead.
  if (schemaMode) {
    const applied = spawnSync("docker", ["exec", "-i", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
      input: readFileSync(path.join(ROOT, "supabase/schemas/zz_product_media_jobs.sql")),
      encoding: "utf8", windowsHide: true, timeout: 30_000,
    });
    if (applied.status !== 0) { console.error(applied.stderr); throw new Error("schema_failed"); }
  }
  const result = spawnSync("supabase", ["test", "db", "--local", "--workdir", directory, path.join(ROOT, "supabase/tests/database/media_jobs.test.sql")], {
    encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
  });
  console.log(result.stdout);
  if (result.status !== 0 || result.error) throw new Error("media_jobs_pgtap_failed");
  const status = JSON.parse(command("supabase", ["status", "--workdir", directory, "--output", "json"], "isolated_status_failed"));
  assert.equal(status.API_URL, "http://127.0.0.1:56421");
  const headers = { apikey: status.SERVICE_ROLE_KEY, authorization: `Bearer ${status.SERVICE_ROLE_KEY}`, "content-type": "application/json" };
  const rpc = async (name, body, overrideHeaders = headers) => {
    const response = await fetch(`${status.API_URL}/rest/v1/rpc/${name}`, {
      method: "POST", headers: overrideHeaders, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    });
    return { status: response.status, ok: response.ok, data: await response.json() };
  };
  const owner = "a".repeat(64);
  const input = readFileSync(path.join(ROOT, "tests/e2e/fixtures/product-photo.jpg"));
  const sha = createHash("sha256").update(input).digest("hex");
  const reserve = (id, draft) => rpc("reserve_product_media_job", { p_id: id, p_draft: draft, p_owner: owner, p_mode: "normal", p_type: "image/jpeg", p_bytes: input.length });
  const draft = randomUUID();
  const sameDraft = await Promise.all(Array.from({ length: 15 }, () => reserve(randomUUID(), draft)));
  assert.equal(sameDraft.filter(r => r.ok).length, 10);
  assert.ok(sameDraft.filter(r => !r.ok).every(r => r.data.message === "media_job_limit"));

  for (const [table, body] of [
    ["categories", { slug: "media-concurrency", name: "Local", description: "", icon: "gear", image: "" }],
    ["products", { id: "11111111-1111-4111-8111-111111111111", slug: "media-concurrency", name: "Local", category_slug: "media-concurrency", short_description: "" }],
  ]) {
    const response = await fetch(`${status.API_URL}/rest/v1/${table}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 201);
  }
  const ids = Array.from({ length: 15 }, () => randomUUID());
  for (const id of ids) assert.equal((await reserve(id, randomUUID())).ok, true);
  const queued = await Promise.all(ids.map(id => rpc("queue_product_media_job", { p_id: id, p_owner: owner, p_product: "11111111-1111-4111-8111-111111111111", p_sha: sha })));
  assert.equal(queued.filter(r => r.ok).length, 10);
  assert.ok(queued.filter(r => !r.ok).every(r => r.data.message === "media_job_limit"));
  const leases = await Promise.all(Array.from({ length: 10 }, () => rpc("claim_product_media_job", { p_seconds: 120 })));
  assert.ok(leases.every(r => r.ok && r.data.length === 1));
  const jobs = leases.map(r => r.data[0]);
  assert.equal(new Set(jobs.map(j => j.id)).size, 10);
  assert.equal(new Set(jobs.map(j => j.image_order)).size, 10);
  assert.deepEqual((await rpc("claim_product_media_job", { p_seconds: 120 })).data, []);

  const job = jobs[0];
  const prepared = await processProductPhoto({ input, contentType: job.content_type, mode: job.mode, productSlug: job.product_slug, imageId: job.id });
  const receipt = { inputSha256: prepared.inputSha256 };
  for (const kind of ["master", "thumbnail", "gallery"]) {
    const { path: objectPath, contentType, bytes, sha256 } = prepared[kind];
    receipt[kind] = { path: objectPath, contentType, bytes, sha256 };
  }
  const finish = { p_id: job.id, p_token: job.lease_token, p_receipt: receipt, p_base: "https://media.example.invalid" };
  const finished = await Promise.all([rpc("finish_product_media_job", finish), rpc("finish_product_media_job", finish)]);
  assert.ok(finished.every(r => r.ok && r.data === job.id));
  const imageResponse = await fetch(`${status.API_URL}/rest/v1/product_images?id=eq.${job.id}`, { headers, signal: AbortSignal.timeout(10_000) });
  assert.equal(imageResponse.status, 200);
  assert.equal((await imageResponse.json()).length, 1);
  const anon = status.ANON_KEY;
  const denied = await rpc("claim_product_media_job", { p_seconds: 120 }, { apikey: anon, authorization: `Bearer ${anon}`, "content-type": "application/json" });
  assert.equal(denied.ok, false);
  console.log(JSON.stringify({ concurrency: true, draftLimit: true, productLimit: true, distinctLeases: 10, duplicateFinalize: "one_row", actualSharpReceipt: true, storageTested: false, anonymousDenied: true }));

  ok = true;
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.message }));
  process.exitCode = 1;
} finally {
  let stopped = !started;
  try {
    if (started) {
      command("supabase", ["stop", "--workdir", directory, "--no-backup", "--yes"], "isolated_cleanup_failed");
      stopped = true;
    }
  } catch {
    process.exitCode = 1;
    console.error(JSON.stringify({ ok: false, code: "isolated_cleanup_failed", directory }));
  }
  if (stopped) {
    const canonical = realpathSync(directory);
    if (path.dirname(canonical) !== realpathSync(os.tmpdir()) || !path.basename(canonical).startsWith(PREFIX)
      || canonical !== path.resolve(directory) || lstatSync(directory).isSymbolicLink()) throw new Error("unsafe_cleanup");
    rmSync(directory, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ ok, cleanup: stopped, schemaMode }));
}
