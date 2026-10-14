import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectPackageInventory } from "../scripts/cloudflare/package-integrity.mjs";
import { inspectPublicationPackage } from "../scripts/cloudflare/publication-package-inspector.mjs";
import { createWranglerInactivePort, createWranglerReleasePort, type WranglerCommand } from "@/cloudflare/publication/wrangler-inactive-port";

// Offline only: every command goes to an injected fake runner. No Cloudflare call is made.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const oldId = "30000000-0000-4000-8000-000000000001";
const newId = "40000000-0000-4000-8000-000000000001";
const oldDeployment = "50000000-0000-4000-8000-000000000001";
const newDeployment = "50000000-0000-4000-8000-000000000002";
const rollbackDeployment = "50000000-0000-4000-8000-000000000003";
const origin = "https://staging-catalog.supabase.co";
const previewUrl = "https://40000000-ayprom-publication-staging.ayprom-staging.workers.dev";
const WORKER = "ayprom-publication-staging";

async function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "ayprom-wrangler-release-test-"));
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
  // Mutable fake provider state: what `deployments list` returns after each command.
  const state = { deployments: [{ id: oldDeployment, created_on: "2026-10-08T00:00:00.000Z",
    versions: [{ version_id: oldId, percentage: 100 }] }] as Array<{ id: string; created_on: string;
    versions: Array<{ version_id: string; percentage: number }> }> };
  const commands: WranglerCommand[] = [];
  let clock = 1;
  const run = vi.fn(async (command: WranglerCommand) => {
    commands.push(command);
    if (command.args[0] === "rollback") {
      // `wrangler rollback` writes no structured record; in CI it auto-confirms a changed secret.
      clock += 1;
      state.deployments.unshift({ id: rollbackDeployment, created_on: `2026-10-08T0${clock}:00:00.000Z`,
        versions: [{ version_id: command.args[1], percentage: 100 }] });
      return { status: 0, stdout: "Worker Version rolled back", stderr: "" };
    }
    if (command.args[1] === "upload") {
      writeFileSync(command.env.WRANGLER_OUTPUT_FILE_PATH!, JSON.stringify({ type: "version-upload", version: 1,
        worker_name: WORKER, version_id: newId, preview_url: previewUrl }) + "\n");
      return { status: 0, stdout: "private-token logs", stderr: "private-token logs" };
    }
    if (command.args[1] === "deploy") {
      const version = command.args[2].split("@")[0];
      const id = state.deployments.length === 1 ? newDeployment : rollbackDeployment;
      clock += 1;
      state.deployments.unshift({ id, created_on: `2026-10-08T0${clock}:00:00.000Z`, versions: [{ version_id: version, percentage: 100 }] });
      writeFileSync(command.env.WRANGLER_OUTPUT_FILE_PATH!, JSON.stringify({ type: "version-deploy", version: 1,
        worker_name: WORKER, worker_tag: null, deployment_id: id, version_traffic: {} }) + "\n");
      return { status: 0, stdout: "private-token logs", stderr: "private-token logs" };
    }
    return { status: 0, stdout: JSON.stringify(state.deployments), stderr: "" };
  });
  const make = () => createWranglerReleasePort({ candidate, wranglerPath, target, apiToken: "test-api-private", run });
  return { root, candidate, wranglerPath, target, state, commands, run, make };
}

describe("concrete Wrangler release transport, offline fake runner only", () => {
  it("activates only a version this port uploaded, with limited arguments and a correlated deployment", async () => {
    const f = await fixture();
    const port = f.make();
    await expect(port.activate(newId)).rejects.toThrow("wrangler_release_unavailable");
    expect(f.run).not.toHaveBeenCalled();
    await port.uploadInactive(f.candidate.packageDir);
    let privateDir = "";
    f.run.mockImplementationOnce(async (command) => {
      privateDir = command.cwd;
      expect(command.args.slice(0, 4)).toEqual(["versions", "deploy", `${newId}@100`, "--yes"]);
      const config = JSON.parse(readFileSync(command.args[command.args.indexOf("--config") + 1], "utf8"));
      expect(config).toMatchObject({ name: WORKER, account_id: "a".repeat(32), workers_dev: false });
      expect(command.args.join(" ")).not.toMatch(/test-api-private|test-capability-private|secrets-file/);
      expect(JSON.stringify(config)).not.toContain("test-capability-private");
      expect(command.env.CLOUDFLARE_API_TOKEN).toBe("test-api-private");
      expect(command.env).not.toHaveProperty("ADMIN_SUPABASE_KEY");
      expect(command.env.WRANGLER_SEND_METRICS).toBe("false");
      expect(command.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV).toBe("false");
      f.state.deployments.unshift({ id: newDeployment, created_on: "2026-10-08T02:00:00.000Z",
        versions: [{ version_id: newId, percentage: 100 }] });
      writeFileSync(command.env.WRANGLER_OUTPUT_FILE_PATH!, JSON.stringify({ type: "version-deploy", version: 1,
        worker_name: WORKER, worker_tag: null, deployment_id: newDeployment, version_traffic: {} }) + "\n");
      return { status: 0, stdout: "private-token", stderr: "" };
    });
    expect(await port.activate(newId)).toEqual({ deploymentId: newDeployment });
    expect(existsSync(privateDir)).toBe(false);
    expect(await port.currentDeployment()).toEqual({ deploymentId: newDeployment, versionId: newId });
  });

  it("never retries an activation: a second call is refused without a command", async () => {
    const f = await fixture();
    const port = f.make();
    await port.uploadInactive(f.candidate.packageDir);
    await port.activate(newId);
    const calls = f.run.mock.calls.length;
    await expect(port.activate(newId)).rejects.toThrow("wrangler_release_unavailable");
    expect(f.run.mock.calls.length).toBe(calls);
  });

  it.each(["nonzero", "invalid-json", "duplicate", "wrong-worker", "wrong-type", "bad-deployment", "oversize"])(
    "rejects %s activation output without leaking text or retrying", async (kind) => {
      const f = await fixture();
      const port = f.make();
      await port.uploadInactive(f.candidate.packageDir);
      f.run.mockImplementationOnce(async (command) => {
        const good = { type: "version-deploy", version: 1, worker_name: WORKER, worker_tag: null,
          deployment_id: newDeployment, version_traffic: {} };
        let content = JSON.stringify(good) + "\n";
        if (kind === "invalid-json") content = "private-token";
        if (kind === "duplicate") content += content;
        if (kind === "wrong-worker") content = JSON.stringify({ ...good, worker_name: "production" });
        if (kind === "wrong-type") content = JSON.stringify({ ...good, type: "deploy" });
        if (kind === "bad-deployment") content = JSON.stringify({ ...good, deployment_id: "../private-token" });
        if (kind === "oversize") content = "private-token".repeat(10000);
        writeFileSync(command.env.WRANGLER_OUTPUT_FILE_PATH!, content);
        return { status: kind === "nonzero" ? 1 : 0, stdout: "private-token", stderr: "private-token" };
      });
      const error = (await port.activate(newId).then(() => new Error("activated"), (e: unknown) => e)) as Error;
      expect(error.message).toBe("wrangler_release_unavailable");
      expect(JSON.stringify(error)).not.toContain("private-token");
      expect(String((error as Error).stack)).not.toContain("private-token");
      const calls = f.run.mock.calls.length;
      await expect(port.activate(newId)).rejects.toThrow("wrangler_release_unavailable");
      expect(f.run.mock.calls.length).toBe(calls);
    });

  it("treats an answer that does not match the actual latest deployment as unknown", async () => {
    const f = await fixture();
    const port = f.make();
    await port.uploadInactive(f.candidate.packageDir);
    f.run.mockImplementationOnce(async (command) => {
      // Provider answers with a deployment id, but the list still shows the old one.
      writeFileSync(command.env.WRANGLER_OUTPUT_FILE_PATH!, JSON.stringify({ type: "version-deploy", version: 1,
        worker_name: WORKER, worker_tag: null, deployment_id: newDeployment, version_traffic: {} }) + "\n");
      return { status: 0, stdout: "", stderr: "" };
    });
    await expect(port.activate(newId)).rejects.toThrow("wrangler_release_unavailable");
  });

  it("rolls back by deploying the previous version once, correlated with the actual list", async () => {
    const f = await fixture();
    const port = f.make();
    await port.uploadInactive(f.candidate.packageDir);
    await port.activate(newId);
    f.run.mockClear();
    expect(await port.rollback(oldId)).toEqual({ deploymentId: rollbackDeployment });
    // Cloudflare refuses `versions deploy` of an older version whose secret differs (code 10220);
    // only `wrangler rollback` handles that case, so the transport must use it.
    expect(f.commands.some((c) => c.args[0] === "versions" && c.args[1] === "deploy" && c.args[2] === `${oldId}@100`)).toBe(false);
    expect(f.commands.filter((c) => c.args[0] === "rollback").at(-1)!.args.slice(0, 5))
      .toEqual(["rollback", oldId, "--message", "ayprom publication rollback", "--yes"]);
    expect(await port.currentDeployment()).toEqual({ deploymentId: rollbackDeployment, versionId: oldId });
    await expect(port.rollback(oldId)).rejects.toThrow("wrangler_release_unavailable");
    await expect(createWranglerReleasePort({ candidate: f.candidate, wranglerPath: f.wranglerPath,
      target: f.target, apiToken: "test-api-private", run: f.run }).rollback("not-a-version"))
      .rejects.toThrow("wrangler_release_unavailable");
  });

  // Real Wrangler 4.135 writes a "wrangler-session" record before the command's own record.
  it("accepts the real Wrangler output shape: a session record before the upload and deploy records", async () => {
    const f = await fixture();
    const session = JSON.stringify({ type: "wrangler-session", version: 1, wrangler_version: "4.135.0", command_line_args: ["x"] }) + "\n";
    const original = f.run.getMockImplementation()!;
    f.run.mockImplementation(async (command) => {
      const result = await original(command);
      const file = command.env.WRANGLER_OUTPUT_FILE_PATH!;
      if (existsSync(file)) writeFileSync(file, session + readFileSync(file, "utf8"));
      return result;
    });
    const port = f.make();
    expect(await port.uploadInactive(f.candidate.packageDir)).toEqual({ versionId: newId });
    expect(await port.activate(newId)).toEqual({ deploymentId: newDeployment });
  });

  it("still rejects two real upload records even when a session record is present", async () => {
    const f = await fixture();
    const record = JSON.stringify({ type: "version-upload", version: 1, worker_name: WORKER, version_id: newId, preview_url: previewUrl }) + "\n";
    const session = JSON.stringify({ type: "wrangler-session", version: 1 }) + "\n";
    f.run.mockImplementationOnce(async (command) => {
      writeFileSync(command.env.WRANGLER_OUTPUT_FILE_PATH!, session + record + record);
      return { status: 0, stdout: "", stderr: "" };
    });
    await expect(f.make().uploadInactive(f.candidate.packageDir)).rejects.toThrow("wrangler_inactive_unavailable");
  });

  it.each(["no-new-deployment", "wrong-version", "nonzero"])("treats a rollback with %s as unknown, never as success", async (kind) => {
    const f = await fixture();
    const port = f.make();
    await port.uploadInactive(f.candidate.packageDir);
    await port.activate(newId);
    f.run.mockImplementationOnce(async (command) => {
      if (kind === "wrong-version") {
        f.state.deployments.unshift({ id: rollbackDeployment, created_on: "2026-10-08T09:00:00.000Z",
          versions: [{ version_id: newId, percentage: 100 }] });
      }
      return { status: kind === "nonzero" ? 1 : 0, stdout: "private-token", stderr: "private-token" + command.args[0] };
    });
    // The first mocked call is the pre-read of the current deployment, so answer it normally.
    f.run.mockImplementationOnce(async () => ({ status: 0, stdout: JSON.stringify(f.state.deployments), stderr: "" }));
    const error = (await port.rollback(oldId).then(() => new Error("rolled back"), (e: unknown) => e)) as Error;
    expect(error.message).toBe("wrangler_release_unavailable");
    expect(JSON.stringify(error)).not.toContain("private-token");
  });

  // A real upload prints every asset file (143 KB for ~200 files); the structured record is in the output file.
  it("accepts a large human-readable stdout when the structured output file is valid, but not an absurd one", async () => {
    const f = await fixture();
    const original = f.run.getMockImplementation()!;
    f.run.mockImplementationOnce(async (command) => ({ ...(await original(command)), stdout: "asset ".repeat(40_000) }));
    expect(await f.make().uploadInactive(f.candidate.packageDir)).toEqual({ versionId: newId });
    f.run.mockImplementationOnce(async (command) => ({ ...(await original(command)), stdout: "x".repeat(9 * 1024 * 1024) }));
    await expect(f.make().uploadInactive(f.candidate.packageDir)).rejects.toThrow("wrangler_inactive_unavailable");
  });

  it("keeps the staging inactive adapter incapable of activation or rollback", async () => {
    const f = await fixture();
    const inactive = createWranglerInactivePort({ candidate: f.candidate, wranglerPath: f.wranglerPath,
      target: f.target, apiToken: "test-api-private", run: f.run });
    await expect(inactive.activate(newId)).rejects.toThrow("inactive_adapter_only");
    await expect(inactive.rollback(oldId)).rejects.toThrow("inactive_adapter_only");
    expect(f.run).not.toHaveBeenCalled();
  });
});
