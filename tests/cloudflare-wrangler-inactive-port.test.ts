import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectPackageInventory } from "../scripts/cloudflare/package-integrity.mjs";
import { inspectPublicationPackage } from "../scripts/cloudflare/publication-package-inspector.mjs";
import { stagePublicationPackage } from "@/cloudflare/publication/stage-publication-package";
import { createReleaseJournal } from "@/cloudflare/publication/release-journal";
import { createWranglerInactivePort, type WranglerCommand } from "@/cloudflare/publication/wrangler-inactive-port";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const oldId = "30000000-0000-4000-8000-000000000001";
const newId = "40000000-0000-4000-8000-000000000001";
const deploymentId = "50000000-0000-4000-8000-000000000001";
const origin = "https://staging-catalog.supabase.co";
const previewUrl = "https://40000000-ayprom-publication-staging.ayprom-staging.workers.dev";
async function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "ayprom-wrangler-port-test-"));
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
  const target = { kind: "staging" as const, accountId: "a".repeat(32), workersSubdomain: "ayprom-staging",
    supabaseUrl: origin, publishableKey: "sb_publishable_test_only", publicationCapability: "test-capability-private" };
  const record = { type: "version-upload", version: 1, worker_name: "ayprom-publication-staging",
    version_id: newId, preview_url: previewUrl };
  const deployments = [{ id: deploymentId, created_on: "2026-10-08T00:00:00.000Z",
    versions: [{ version_id: oldId, percentage: 100 }] }];
  const commands: WranglerCommand[] = [];
  const run = vi.fn(async (command: WranglerCommand) => {
    commands.push(command);
    if (command.args[0] === "versions") {
      writeFileSync(command.env.WRANGLER_OUTPUT_FILE_PATH!, JSON.stringify(record) + "\n");
      return { status: 0, stdout: "private-token logs", stderr: "private-token logs" };
    }
    return { status: 0, stdout: JSON.stringify(deployments), stderr: "" };
  });
  const port = createWranglerInactivePort({ candidate, wranglerPath, target, apiToken: "test-api-private", run });
  return { root, candidate, wranglerPath, target, record, deployments, commands, run, port };
}

describe("concrete Wrangler inactive staging adapter, offline commands only", () => {
  it("uses structured output, limited config and secret file; never deploys or mutates the package", async () => {
    const f = await fixture();
    const before = readFileSync(path.join(f.candidate.packageDir, "wrangler.jsonc"), "utf8");
    let privateDir = "";
    f.run.mockImplementationOnce(async (command) => {
      privateDir = command.cwd;
      expect(command.args.slice(0, 2)).toEqual(["versions", "upload"]);
      expect(command.args).toContain("--no-bundle");
      expect(command.args).toContain("--strict");
      const configPath = command.args[command.args.indexOf("--config") + 1];
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      expect(config).toMatchObject({ name: "ayprom-publication-staging", account_id: "a".repeat(32),
        workers_dev: false, preview_urls: true, send_metrics: false,
        vars: { SUPABASE_URL: origin, PUBLICATION_ID: f.candidate.releaseId },
        assets: { binding: "ASSETS", directory: path.join(f.candidate.packageDir, "site") } });
      expect(config.main).toBe(path.join(f.candidate.packageDir, "worker.js"));
      expect(config).not.toHaveProperty("routes");
      expect(JSON.stringify(config)).not.toContain("test-capability-private");
      const secretPath = command.args[command.args.indexOf("--secrets-file") + 1];
      expect(JSON.parse(readFileSync(secretPath, "utf8"))).toEqual({ PUBLICATION_CAPABILITY: "test-capability-private" });
      expect(command.args.join(" ")).not.toContain("test-api-private");
      expect(command.env).not.toHaveProperty("ADMIN_SUPABASE_KEY");
      expect(command.env.WRANGLER_SEND_METRICS).toBe("false");
      expect(command.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV).toBe("false");
      writeFileSync(command.env.WRANGLER_OUTPUT_FILE_PATH!, JSON.stringify(f.record) + "\n");
      return { status: 0, stdout: "private-token", stderr: "" };
    });
    expect(await f.port.uploadInactive(f.candidate.packageDir)).toEqual({ versionId: newId });
    expect(await f.port.preview(newId)).toEqual({ url: previewUrl });
    expect(existsSync(privateDir)).toBe(false);
    expect(readFileSync(path.join(f.candidate.packageDir, "wrangler.jsonc"), "utf8")).toBe(before);
    expect(f.run).toHaveBeenCalledTimes(1);
    await expect(f.port.activate(newId)).rejects.toThrow("inactive_adapter_only");
    await expect(f.port.rollback(oldId)).rejects.toThrow("inactive_adapter_only");
    expect(f.run).toHaveBeenCalledTimes(1);
  });

  it("selects latest deployment by time, and rejects split traffic instead of guessing", async () => {
    const f = await fixture();
    f.deployments.unshift({ id: "50000000-0000-4000-8000-000000000002",
      created_on: "2026-10-08T01:00:00.000Z", versions: [{ version_id: newId, percentage: 100 }] });
    expect(await f.port.currentDeployment()).toEqual({ deploymentId: f.deployments[0].id, versionId: newId });
    f.deployments[0].versions = [{ version_id: newId, percentage: 50 }, { version_id: oldId, percentage: 50 }];
    await expect(f.port.currentDeployment()).rejects.toThrow("wrangler_inactive_unavailable");
  });

  it.each(["invalid-json", "duplicate", "wrong-worker", "wrong-url", "missing-preview", "nonzero", "oversize"])(
    "rejects %s upload output without retry or leaking text", async (kind) => {
      const f = await fixture();
      f.run.mockImplementationOnce(async (command) => {
        let content = JSON.stringify(f.record) + "\n";
        if (kind === "invalid-json") content = "private-token";
        if (kind === "duplicate") content += content;
        if (kind === "wrong-worker") content = JSON.stringify({ ...f.record, worker_name: "production" });
        if (kind === "wrong-url") content = JSON.stringify({ ...f.record, preview_url: "https://evil.example/private-token" });
        if (kind === "missing-preview") content = JSON.stringify({ ...f.record, preview_url: null });
        if (kind === "oversize") content = "private-token".repeat(10000);
        writeFileSync(command.env.WRANGLER_OUTPUT_FILE_PATH!, content);
        return { status: kind === "nonzero" ? 1 : 0, stdout: "private-token", stderr: "private-token" };
      });
      await expect(f.port.uploadInactive(f.candidate.packageDir)).rejects.toThrow("wrangler_inactive_unavailable");
      expect(f.run).toHaveBeenCalledTimes(1);
      await expect(f.port.preview(newId)).rejects.toThrow("wrangler_inactive_unavailable");
    });

  it("rechecks digest before runner and rejects other package paths", async () => {
    const f = await fixture();
    await expect(f.port.uploadInactive(path.join(f.root, "other"))).rejects.toThrow("wrangler_inactive_unavailable");
    writeFileSync(path.join(f.candidate.packageDir, "worker.js"), "private-token");
    await expect(f.port.uploadInactive(f.candidate.packageDir)).rejects.toThrow("wrangler_inactive_unavailable");
    expect(f.run).not.toHaveBeenCalled();
  });

  it("contains timeout exceptions and makes only one attempt", async () => {
    const f = await fixture();
    f.run.mockRejectedValueOnce(new Error("private-token"));
    await expect(f.port.uploadInactive(f.candidate.packageDir)).rejects.toThrow(/^wrangler_inactive_unavailable$/);
    expect(f.run).toHaveBeenCalledTimes(1);
    expect(existsSync(f.commands[0]?.cwd ?? "missing")).toBe(false);
  });

  it("uses the real Node child transport against a local stub without reaching Cloudflare", async () => {
    const f = await fixture();
    const stub = path.join(f.root, "wrangler-stub.cjs");
    writeFileSync(stub, `const fs = require("node:fs");
if (process.argv[2] === "deployments") process.stdout.write(${JSON.stringify(JSON.stringify(f.deployments))});
else fs.writeFileSync(process.env.WRANGLER_OUTPUT_FILE_PATH, ${JSON.stringify(JSON.stringify(f.record) + "\n")});
`);
    const port = createWranglerInactivePort({ candidate: f.candidate, target: f.target,
      wranglerPath: stub, apiToken: "test-api-private" });
    expect(await port.currentDeployment()).toEqual({ deploymentId, versionId: oldId });
    expect(await port.uploadInactive(f.candidate.packageDir)).toEqual({ versionId: newId });
    expect(await port.preview(newId)).toEqual({ url: previewUrl });
    await expect(port.uploadInactive(f.candidate.packageDir)).rejects.toThrow("wrangler_inactive_unavailable");
    expect(f.run).not.toHaveBeenCalled();
  });

  it("connects the concrete command adapter to real package inspection and durable history", async () => {
    const f = await fixture();
    const journalPath = path.join(f.root, "release.jsonl");
    const run = f.run.getMockImplementation()!;
    f.run.mockImplementation(async (command) => {
      if (command.args[0] === "versions") {
        const history = await createReleaseJournal({ path: journalPath }).read();
        expect(history.map((e) => e.status)).toEqual(["upload_started"]);
        expect(history[0].packageSha256).toBe(f.candidate.packageSha256);
      }
      return run(command);
    });
    const probe = vi.fn(async () => true);
    const input = { candidate: f.candidate, cloudflare: f.port, probe, journalPath };
    expect(await stagePublicationPackage(input)).toMatchObject({ ok: true, status: "inactive_verified", productionReady: false });
    expect(probe).toHaveBeenCalledWith({ url: previewUrl, versionId: newId, releaseId: f.candidate.releaseId });
    const commands = f.run.mock.calls.length;
    expect(await stagePublicationPackage(input)).toMatchObject({ ok: false, status: "rejected" });
    expect(f.run).toHaveBeenCalledTimes(commands);
    expect((await createReleaseJournal({ path: journalPath }).read()).map((e) => e.status))
      .toEqual(["upload_started", "inactive_uploaded", "inactive_verified"]);
  });

  it.each(["empty", "malformed", "same-time", "invalid-date", "impossible-date", "wrong-id", "nonzero"])(
    "rejects %s deployment responses instead of guessing", async (kind) => {
      const f = await fixture();
      let records: unknown = f.deployments;
      if (kind === "empty") records = [];
      if (kind === "malformed") records = { private: "private-token" };
      if (kind === "same-time") records = [f.deployments[0], { ...f.deployments[0], id: newId }];
      if (kind === "invalid-date") records = [{ ...f.deployments[0], created_on: "private-token" }];
      if (kind === "impossible-date") records = [{ ...f.deployments[0], created_on: "2026-02-30T00:00:00.000Z" }];
      if (kind === "wrong-id") records = [{ ...f.deployments[0], id: "--deploy" }];
      f.run.mockResolvedValueOnce({ status: kind === "nonzero" ? 1 : 0,
        stdout: JSON.stringify(records), stderr: "private-token" });
      await expect(f.port.currentDeployment()).rejects.toThrow(/^wrangler_inactive_unavailable$/);
      expect(f.run).toHaveBeenCalledTimes(1);
    });
  it("rejects unsafe target input before selecting any command", async () => {
    const f = await fixture();
    for (const target of [{ ...f.target, kind: "production" }, { ...f.target, supabaseUrl: "https://user:private-token@staging-catalog.supabase.co" },
      { ...f.target, accountId: "--deploy" }, { ...f.target, workersSubdomain: "evil.example" },
      { ...f.target, publishableKey: "sb_secret_private-token" }]) {
      expect(() => createWranglerInactivePort({ ...f, target: target as typeof f.target,
        apiToken: "test-api-private" })).toThrow(/^wrangler_inactive_unavailable$/);
    }
    expect(f.run).not.toHaveBeenCalled();
  });
});
