// Isolated local pgTAP/PostgREST gate for immutable catalog releases.
// Never touches the shared site-for-kirsan Supabase stack.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPortsFree, createIsolatedProject } from "./local-admin-auth-smoke.mjs";
import { probeCatalogPublicationHttp } from "./catalog-publication-http-probes.mjs";
import { probeCatalogCapture } from "./catalog-publication-capture-probes.mjs";
import { probePublicationControl } from "./publication-control-http-probes.mjs";
import { probePublicationQueueState } from "./publication-queue-state-http-probes.mjs";
import { probePublicationCoordinator } from "./publication-coordinator-http-probes.mjs";
import { runLocalReleaseDrill } from "./local-release-drill.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PREFIX = "ayprom-catalog-publication-";
const TESTS = ["catalog_publications.test.sql", "catalog_publication_capture.test.sql", "catalog_publication_control.test.sql", "publication_job_state.test.sql"]
  .map((name) => path.join(ROOT, "supabase/tests/database", name));
const allTests = process.argv.slice(2).length === 1 && process.argv[2] === "--all";
const pinnedBuild = process.argv.slice(2).length === 1 && process.argv[2] === "--pinned-build";
const releaseDrill = process.argv.slice(2).length === 1 && process.argv[2] === "--release-drill";
if (process.argv.length > 2 && !allTests && !pinnedBuild && !releaseDrill) throw new Error("invalid_contract_arguments");

function run(args, timeout = 360_000) {
  return spawnSync(process.platform === "win32" ? "supabase.exe" : "supabase", args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
}

function safeTemporaryDirectory(directory) {
  const resolved = realpathSync(directory);
  return resolved === path.resolve(directory)
    && path.dirname(resolved) === realpathSync(os.tmpdir())
    && path.basename(resolved).startsWith(PREFIX)
    && lstatSync(directory).isDirectory()
    && !lstatSync(directory).isSymbolicLink();
}

await assertPortsFree();
const directory = mkdtempSync(path.join(os.tmpdir(), PREFIX));
let startupAttempted = false;
let cleanupSafe = true;
const projectId = `ayprom-catalog-${randomBytes(5).toString("hex")}`;
function localSql(sql) {
  const result = spawnSync("docker", ["exec", "-i", `supabase_db_${projectId}`,
    "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
    input: sql, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0 || result.error) throw new Error("catalog_fixture_sql_failed");
  return result.stdout;
}
try {
  createIsolatedProject(directory, projectId);
  startupAttempted = true;
  const startup = run(["start", "--workdir", directory, "--exclude",
    "studio,realtime,storage-api,imgproxy,postgres-meta,mailpit,edge-runtime,logflare,vector,supavisor", "--yes"]);
  if (startup.status !== 0 || startup.error) {
    console.error("isolated_catalog_stack_start_failed");
    const sqlState = (String(startup.stdout ?? "") + String(startup.stderr ?? "")).match(/SQLSTATE ([0-9A-Z]{5})/);
    if (sqlState) console.error(JSON.stringify({ code: "isolated_migration_failed", sqlState: sqlState[1] }));
    process.exitCode = 1;
  } else {
    localSql(readFileSync(path.join(ROOT, "supabase/tests/fixtures/catalog-publication-empty-probe.sql"), "utf8"));
    console.log(JSON.stringify({ emptyCapture: { ok: true } }));
    // Existing SQL suites use the repository's local-development seed. Never
    // seed the shared stack; this container ID belongs to this run exclusively.
    if (allTests || pinnedBuild || releaseDrill) localSql(readFileSync(path.join(ROOT, "supabase/seed.sql"), "utf8"));
    const targets = allTests ? [path.join(ROOT, "supabase/tests/database")] : TESTS;
    const result = run(["test", "db", "--local", "--workdir", directory, ...targets], 120_000);
    process.stdout.write(result.stdout ?? "");
    if (result.status !== 0 || result.error) {
      console.error("catalog_publications_pgtap_failed");
      process.exitCode = 1;
    }
    const status = run(["status", "--workdir", directory, "--output", "json"], 30_000);
    if (status.status !== 0 || status.error) throw new Error("catalog_stack_status_failed");
    const bindings = JSON.parse(status.stdout);
    localSql(readFileSync(path.join(ROOT, "supabase/tests/fixtures/catalog-publications.sql"), "utf8"));
    const http = await probeCatalogPublicationHttp(bindings.API_URL, bindings.PUBLISHABLE_KEY ?? bindings.ANON_KEY,
      () => localSql("insert into catalog_private.catalog_publication_active(release_id) values ('10000000-0000-4000-8000-000000000001');"),
      () => localSql("update catalog_private.catalog_releases set state='revoked' where id='10000000-0000-4000-8000-000000000002';"));
    console.log(JSON.stringify({ postgrest: http }));
    const capture = await probeCatalogCapture({ apiUrl: bindings.API_URL,
      publicKey: bindings.PUBLISHABLE_KEY ?? bindings.ANON_KEY,
      privateKey: bindings.SECRET_KEY ?? bindings.SERVICE_ROLE_KEY, projectId, localSql, root: ROOT });
    console.log(JSON.stringify({ capture }));
    if (process.exitCode !== 1) {
      const publicationControl = await probePublicationControl({ apiUrl: bindings.API_URL,
        publicKey: bindings.PUBLISHABLE_KEY ?? bindings.ANON_KEY,
        privateKey: bindings.SECRET_KEY ?? bindings.SERVICE_ROLE_KEY, projectId, localSql, root: ROOT });
      console.log(JSON.stringify({ publicationControl }));
      const publicationQueueState = await probePublicationQueueState({ apiUrl: bindings.API_URL,
        publicKey: bindings.PUBLISHABLE_KEY ?? bindings.ANON_KEY,
        privateKey: bindings.SECRET_KEY ?? bindings.SERVICE_ROLE_KEY, projectId, localSql, root: ROOT });
      console.log(JSON.stringify({ publicationQueueState }));
      const publicationCoordinator = await probePublicationCoordinator({ apiUrl: bindings.API_URL,
        publicKey: bindings.PUBLISHABLE_KEY ?? bindings.ANON_KEY,
        privateKey: bindings.SECRET_KEY ?? bindings.SERVICE_ROLE_KEY, projectId, localSql, root: ROOT });
      console.log(JSON.stringify({ publicationCoordinator }));
    }
    if (releaseDrill && process.exitCode !== 1) {
      // Real packages + workerd + Chromium + isolated DB; only the Cloudflare switch is local.
      const drill = await runLocalReleaseDrill({ apiUrl: bindings.API_URL,
        publicKey: bindings.PUBLISHABLE_KEY ?? bindings.ANON_KEY,
        privateKey: bindings.SECRET_KEY ?? bindings.SERVICE_ROLE_KEY, projectId, localSql, root: ROOT });
      console.log(JSON.stringify({ releaseDrill: drill }));
    }
    if (pinnedBuild) {
      const packageName = `pinned-local-${randomBytes(8).toString("hex")}`;
      const output = path.join(ROOT, "dist", "worker-packages", packageName);
      const published = path.join(ROOT, "dist", "worker-packages", "pinned-local-previous-absent");
      const built = spawnSync(process.execPath, [path.join(ROOT, "scripts/cloudflare/workers-build-runner.mjs"),
        "--local-pinned", "--published", published, "--package", output], {
        cwd: ROOT, windowsHide: true, encoding: "utf8", timeout: 1_200_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, AYPROM_WORKERS_BUILD_MODE: "loopback-fixture",
          AYPROM_WORKERS_BUILD_SUPABASE_URL: bindings.API_URL,
          AYPROM_WORKERS_BUILD_SUPABASE_PUBLISHABLE_KEY: bindings.PUBLISHABLE_KEY ?? bindings.ANON_KEY,
          ADMIN_SUPABASE_KEY: bindings.SECRET_KEY ?? bindings.SERVICE_ROLE_KEY },
      });
      let summary = null;
      try { summary = JSON.parse(built.stdout?.trim() ?? ""); } catch { summary = null; }
      const ok = built.status === 0 && !built.error && summary?.ok === true
        && summary.productionReady === false && summary.externalPublication === false
        && summary.pinnedRuntimeOk === true && summary.pinnedBrowserOk === true;
      console.log(JSON.stringify({ pinnedBuild: { ok, code: ok ? null : summary?.code ?? "build_unavailable",
        stage: summary?.stage ?? "unknown", browserStage: summary?.pinnedBrowserStage ?? null,
        browserReason: summary?.pinnedBrowserReason ?? null,
        productionReady: false } }));
      if (!ok) process.exitCode = 1;
    }
    const advisors = run(["db", "advisors", "--local", "--workdir", directory,
      "--type", "security", "--level", "error", "--fail-on", "error"], 120_000);
    process.stdout.write(advisors.stdout ?? "");
    if (advisors.status !== 0 || advisors.error) {
      console.error("catalog_publications_security_advisor_failed");
      process.exitCode = 1;
    }
  }
} catch {
  console.error("catalog_publications_contract_failed");
  process.exitCode = 1;
} finally {
  if (startupAttempted) {
    const stopped = run(["stop", "--workdir", directory, "--no-backup"], 120_000);
    if (stopped.status !== 0 || stopped.error) {
      cleanupSafe = false;
      console.error("isolated_catalog_stack_stop_failed");
      process.exitCode = 1;
    }
  }
  if (cleanupSafe && safeTemporaryDirectory(directory)) rmSync(directory, { recursive: true, force: true });
}
