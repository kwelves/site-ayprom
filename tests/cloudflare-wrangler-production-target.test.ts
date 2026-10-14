import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectPackageInventory } from "../scripts/cloudflare/package-integrity.mjs";
import { inspectPublicationPackage } from "../scripts/cloudflare/publication-package-inspector.mjs";
import { createWranglerReleasePort, type WranglerCommand } from "@/cloudflare/publication/wrangler-inactive-port";

// Offline only: every command goes to an injected fake runner. No Cloudflare call is made.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const newId = "40000000-0000-4000-8000-000000000001";
const PRODUCTION_WORKER = "ayprom-public";

async function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "ayprom-wrangler-production-test-"));
  roots.push(root);
  const packageDir = path.join(root, "package");
  mkdirSync(path.join(packageDir, "site"), { recursive: true });
  writeFileSync(path.join(packageDir, "site/index.html"), "<h1>fixture</h1>");
  writeFileSync(path.join(packageDir, "worker.js"), "export default {};");
  writeFileSync(path.join(packageDir, "source-revision.json"), JSON.stringify({ schemaVersion: 1, revision: 7 }));
  writeFileSync(path.join(packageDir, "wrangler.jsonc"), JSON.stringify({ name: "ayprom-static-worker-package",
    main: "worker.js", compatibility_date: "2026-09-19", compatibility_flags: ["nodejs_compat"], workers_dev: false,
    assets: { directory: "site", html_handling: "drop-trailing-slash", not_found_handling: "404-page",
      run_worker_first: ["/api/*", "/product/*"] } }));
  const inventory = collectPackageInventory(packageDir);
  writeFileSync(path.join(packageDir, "package-manifest.json"), JSON.stringify({
    schemaVersion: 1, ready: true, productionReady: false, sourceRevision: 7,
    release: { id: "20000000-0000-4000-8000-000000000001", revision: 7, sha256: "a".repeat(64) },
    requiredBindings: ["ASSETS", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "PUBLICATION_ID", "PUBLICATION_CAPABILITY"],
    worker: { rawBytes: 18, gzipBytes: 10 }, assets: { fileCount: 1, totalBytes: 16 }, inventory: inventory.inventory,
  }));
  const identity = await inspectPublicationPackage(packageDir);
  if (!identity.ok) throw new Error("fixture_rejected");
  const candidate = { packageDir, releaseId: identity.releaseId, revision: identity.revision,
    releaseSha256: identity.releaseSha256, packageSha256: identity.packageSha256 };
  const wranglerPath = path.resolve(".wrangler/tools/wrangler-4.135.0/node_modules/wrangler/bin/wrangler.js");
  const target = { kind: "production" as const, workerName: PRODUCTION_WORKER, accountId: "a".repeat(32), workersSubdomain: "ayprom-migration",
    supabaseUrl: "https://acyoyvetcyqmwppfenau.supabase.co", publishableKey: "sb_publishable_test_only", publicationCapability: "test-capability-private" };
  const commands: WranglerCommand[] = [];
  const run = vi.fn(async (command: WranglerCommand) => {
    commands.push(command);
    if (command.args[1] === "upload") {
      writeFileSync(command.env.WRANGLER_OUTPUT_FILE_PATH!, JSON.stringify({ type: "version-upload", version: 1,
        worker_name: PRODUCTION_WORKER, version_id: newId, preview_url: `https://40000000-${PRODUCTION_WORKER}.ayprom-migration.workers.dev` }) + "\n");
      return { status: 0, stdout: "private-token logs", stderr: "" };
    }
    return { status: 0, stdout: "[]", stderr: "" };
  });
  return { candidate, wranglerPath, target, commands, run };
}

describe("Wrangler release transport with a production target, offline fake runner only", () => {
  it("uploads to the production Worker named by the target, and expects that Worker's preview address", async () => {
    const f = await fixture();
    const port = createWranglerReleasePort({ candidate: f.candidate, wranglerPath: f.wranglerPath, target: f.target, apiToken: "test-api-private", run: f.run });
    f.run.mockImplementationOnce(async (command) => {
      const config = JSON.parse(readFileSync(command.args[command.args.indexOf("--config") + 1], "utf8"));
      expect(config).toMatchObject({ name: PRODUCTION_WORKER, account_id: "a".repeat(32) });
      expect(config.vars.SUPABASE_URL).toBe("https://acyoyvetcyqmwppfenau.supabase.co");
      writeFileSync(command.env.WRANGLER_OUTPUT_FILE_PATH!, JSON.stringify({ type: "version-upload", version: 1,
        worker_name: PRODUCTION_WORKER, version_id: newId, preview_url: `https://40000000-${PRODUCTION_WORKER}.ayprom-migration.workers.dev` }) + "\n");
      return { status: 0, stdout: "private-token logs", stderr: "" };
    });
    expect(await port.uploadInactive(f.candidate.packageDir)).toEqual({ versionId: newId });
    expect(await port.preview(newId)).toEqual({ url: `https://40000000-${PRODUCTION_WORKER}.ayprom-migration.workers.dev` });
  });

  it("rejects an upload record from a different Worker (staging answering for production)", async () => {
    const f = await fixture();
    const port = createWranglerReleasePort({ candidate: f.candidate, wranglerPath: f.wranglerPath, target: f.target, apiToken: "test-api-private", run: f.run });
    f.run.mockImplementationOnce(async (command) => {
      writeFileSync(command.env.WRANGLER_OUTPUT_FILE_PATH!, JSON.stringify({ type: "version-upload", version: 1,
        worker_name: "ayprom-publication-staging", version_id: newId, preview_url: "https://40000000-ayprom-publication-staging.ayprom-migration.workers.dev" }) + "\n");
      return { status: 0, stdout: "", stderr: "" };
    });
    await expect(port.uploadInactive(f.candidate.packageDir)).rejects.toThrow("wrangler_inactive_unavailable");
  });

  it("refuses unsafe combinations before selecting any command", async () => {
    const f = await fixture();
    const unsafe = [
      { ...f.target, workerName: undefined },                       // production must name its own Worker
      { ...f.target, workerName: "ayprom-publication-staging" },    // ...and never the staging Worker
      { ...f.target, workerName: "Bad Name; rm" },
      { ...f.target, kind: "staging" as const },                    // staging never uses the production Worker
      { ...f.target, kind: "preview" as unknown as "staging" },
    ];
    for (const target of unsafe) {
      expect(() => createWranglerReleasePort({ candidate: f.candidate, wranglerPath: f.wranglerPath, target, apiToken: "test-api-private", run: f.run }))
        .toThrow("wrangler_inactive_unavailable");
    }
    expect(f.run).not.toHaveBeenCalled();
  });
});
