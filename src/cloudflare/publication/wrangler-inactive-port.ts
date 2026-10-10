import { execFile } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync, readSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectPublicationPackage } from "../../../scripts/cloudflare/publication-package-inspector.mjs";
import type { Candidate, CloudflareVersionPort } from "./cloudflare-version-port";

export interface WranglerCommand {
  args: string[];
  cwd: string;
  env: Record<string, string>;
}
interface CommandResult { status: number; stdout: string; stderr: string }
type Runner = (command: WranglerCommand) => Promise<CommandResult>;
interface StagingTarget {
  kind: "staging";
  accountId: string;
  workersSubdomain: string;
  supabaseUrl: string;
  publishableKey: string;
  publicationCapability: string;
}

const WORKER = "ayprom-publication-staging";
const PREFIX = "ayprom-inactive-wrangler-";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_OUTPUT = 64 * 1024; // structured output file (one record)
// Human-readable stdout lists every uploaded asset (143 KB for ~200 files); it is never parsed.
const MAX_STDOUT = 8 * 1024 * 1024;
const unavailable = () => new Error("wrangler_inactive_unavailable");
const releaseUnavailable = () => new Error("wrangler_release_unavailable");

interface PortInput {
  candidate: Candidate;
  wranglerPath: string;
  target: StagingTarget;
  apiToken: string;
  run?: Runner;
}

/** Concrete staging-only transport. Constructing it performs no remote operation.
 * Remote calls require a separately authorized caller; the local CLI never selects it.
 * The staging project's identity, limited DB rights and existing preview setting must
 * be verified independently before use. This port cannot activate or roll back.
 */
export function createWranglerInactivePort(input: PortInput): CloudflareVersionPort {
  return createPort(input, false);
}

/** Same staging-only transport plus one-shot activation and rollback through
 * `wrangler versions deploy <id>@100`. Constructing it performs no remote operation, and the
 * local CLI never selects it. Only the caller that holds separate owner authorization for a
 * staging activation may run it. Wrangler gives no conditional (compare-and-swap) deploy, so
 * every answer is correlated with the actual deployment list; mismatches are unknown results
 * for the coordinator to reconcile. It is never retried by this port.
 */
export function createWranglerReleasePort(input: PortInput): CloudflareVersionPort {
  return createPort(input, true);
}

function createPort(input: PortInput, allowRelease: boolean): CloudflareVersionPort {
  try {
    const apiToken = input.apiToken;
    const wranglerPath = input.wranglerPath;
    const c = { ...input.candidate };
    const t = { ...input.target };
    if (t.kind !== "staging" || !/^[a-f0-9]{32}$/.test(t.accountId)
      || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(t.workersSubdomain)
      || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(t.publishableKey)
      || !/^[A-Za-z0-9_-]{16,256}$/.test(t.publicationCapability)
      || !/^[A-Za-z0-9_-]{8,256}$/.test(apiToken)
      || !path.isAbsolute(c.packageDir) || !UUID.test(c.releaseId)
      || !Number.isSafeInteger(c.revision) || c.revision < 0
      || !HASH.test(c.releaseSha256) || !HASH.test(c.packageSha256)
      || !path.isAbsolute(wranglerPath) || !lstatSync(wranglerPath).isFile()
      || lstatSync(wranglerPath).isSymbolicLink()) throw unavailable();
    const url = new URL(t.supabaseUrl);
    if (url.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)
      || url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw unavailable();

    const candidateDir = path.resolve(c.packageDir);
    const config = {
      name: WORKER, account_id: t.accountId, main: path.join(candidateDir, "worker.js"),
      compatibility_date: "2026-09-19", compatibility_flags: ["nodejs_compat"],
      workers_dev: false, preview_urls: true, send_metrics: false,
      vars: { SUPABASE_URL: url.origin, SUPABASE_PUBLISHABLE_KEY: t.publishableKey, PUBLICATION_ID: c.releaseId },
      assets: { directory: path.join(candidateDir, "site"), binding: "ASSETS",
        html_handling: "drop-trailing-slash", not_found_handling: "404-page",
        run_worker_first: ["/api/*", "/product/*"] },
    };
    const run = input.run ?? ((command: WranglerCommand) => defaultRunner(wranglerPath, command));
    let attempted = false;
    let activated = false;
    let rolledBack = false;
    const previews = new Map<string, string>();

    const execute = async (mode: "upload" | "list" | "deploy" | "rollback", versionId = ""): Promise<{ stdout: string; output: string }> => {
      const upload = mode === "upload";
      let directory: string | undefined;
      try {
        directory = mkdtempSync(path.join(os.tmpdir(), PREFIX));
        const configFile = path.join(directory, "wrangler.json");
        const outputFile = path.join(directory, "output.jsonl");
        writeFileSync(configFile, JSON.stringify(config), { mode: 0o600 });
        const env: Record<string, string> = {};
        // Do not inherit production bindings, Node options, API overrides or dotenv.
        for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"]) {
          const value = process.env[name];
          if (value) env[name] = value;
        }
        Object.assign(env, { CLOUDFLARE_API_TOKEN: apiToken,
          WRANGLER_OUTPUT_FILE_PATH: outputFile, WRANGLER_LOG_PATH: path.join(directory, "wrangler.log"),
          WRANGLER_LOG_SANITIZE: "true", WRANGLER_SEND_METRICS: "false",
          CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false", CI: "true", NO_COLOR: "1" });
        const args = upload
          ? ["versions", "upload", "--config", configFile, "--no-bundle", "--strict"]
          : mode === "deploy"
            ? ["versions", "deploy", `${versionId}@100`, "--yes", "--message", "ayprom publication", "--config", configFile]
            : mode === "rollback"
              // Cloudflare refuses `versions deploy` of an older version whose secret differs (code 10220,
              // always the case: each release has its own capability). `wrangler rollback` handles that
              // case and, without a terminal (CI), confirms the changed secret itself.
              ? ["rollback", versionId, "--message", "ayprom publication rollback", "--yes", "--config", configFile]
              : ["deployments", "list", "--config", configFile, "--json"];
        if (upload) {
          const secretsFile = path.join(directory, "bindings.json");
          writeFileSync(secretsFile, JSON.stringify({ PUBLICATION_CAPABILITY: t.publicationCapability }), { mode: 0o600 });
          args.push("--secrets-file", secretsFile);
        }
        const result = await run({ args, cwd: directory, env });
        if (result.status !== 0 || typeof result.stdout !== "string"
          || Buffer.byteLength(result.stdout) > MAX_STDOUT) throw unavailable();
        // `deployments list` and `rollback` write no structured record (their answer is read from the list).
        const output = mode === "list" || mode === "rollback" ? "" : boundedOutput(outputFile);
        return { stdout: result.stdout, output };
      } catch { throw unavailable(); }
      finally {
        if (directory) cleanupPrivateDirectory(directory);
      }
    };

    // Runs one deploy command, then requires the provider's own deployment list to agree.
    const deploy = async (versionId: string): Promise<{ deploymentId: string }> => {
      try {
        const result = await execute("deploy", versionId);
        const records = parseRecords(result.output);
        if (records.length !== 1) throw releaseUnavailable();
        const record = records[0];
        const deploymentId = record.deployment_id;
        if (record.type !== "version-deploy" || record.version !== 1 || record.worker_name !== WORKER
          || typeof deploymentId !== "string" || !UUID.test(deploymentId)) throw releaseUnavailable();
        const actual = await port.currentDeployment();
        if (actual.deploymentId !== deploymentId || actual.versionId !== versionId) throw releaseUnavailable();
        return { deploymentId };
      } catch { throw releaseUnavailable(); }
    };
    const port: CloudflareVersionPort = {
      async uploadInactive(packageDir) {
        try {
          if (attempted || path.resolve(packageDir) !== candidateDir) throw unavailable();
          const inspected = await inspectPublicationPackage(candidateDir);
          if (!inspected.ok || inspected.releaseId !== c.releaseId || inspected.revision !== c.revision
            || inspected.releaseSha256 !== c.releaseSha256 || inspected.packageSha256 !== c.packageSha256) throw unavailable();
          attempted = true; // No retry after a command may have had a remote effect.
          const result = await execute("upload");
          const records = parseRecords(result.output);
          if (records.length !== 1) throw unavailable();
          const record = records[0];
          const versionId = record.version_id;
          if (record.type !== "version-upload" || record.version !== 1 || record.worker_name !== WORKER
            || typeof versionId !== "string" || !UUID.test(versionId)) throw unavailable();
          const expected = `https://${versionId.slice(0, 8)}-${WORKER}.${t.workersSubdomain}.workers.dev`;
          if (record.preview_url !== expected) throw unavailable();
          previews.set(versionId, expected);
          return { versionId };
        } catch { throw unavailable(); }
      },
      async preview(versionId) {
        const url = previews.get(versionId);
        if (!url) throw unavailable();
        return { url };
      },
      async currentDeployment() {
        try {
          const { stdout } = await execute("list");
          const records: unknown = JSON.parse(stdout);
          if (!Array.isArray(records) || records.length === 0 || records.length > 10) throw unavailable();
          const deployments = records.map((value) => {
            if (!value || typeof value !== "object" || typeof value.id !== "string" || !UUID.test(value.id)
              || typeof value.created_on !== "string"
              || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value.created_on)
              || !Number.isFinite(Date.parse(value.created_on))
              || new Date(value.created_on).toISOString().slice(0, 19) !== value.created_on.slice(0, 19)
              || !Array.isArray(value.versions)) throw unavailable();
            return { id: value.id as string, time: Date.parse(value.created_on), versions: value.versions as unknown[] };
          }).sort((a, b) => b.time - a.time);
          if (deployments.length > 1 && deployments[0].time === deployments[1].time) throw unavailable();
          const latest = deployments[0];
          if (latest.versions.length !== 1) throw unavailable();
          const version = latest.versions[0] as { version_id?: unknown; percentage?: unknown } | null;
          if (!version || typeof version.version_id !== "string" || !UUID.test(version.version_id)
            || version.percentage !== 100) throw unavailable();
          return { deploymentId: latest.id, versionId: version.version_id };
        } catch { throw unavailable(); }
      },
      async activate(versionId) {
        if (!allowRelease) throw new Error("inactive_adapter_only");
        // Only a version this very port uploaded may be activated; one attempt, never retried.
        if (activated || !previews.has(versionId)) throw releaseUnavailable();
        activated = true;
        return deploy(versionId);
      },
      async rollback(versionId) {
        if (!allowRelease) throw new Error("inactive_adapter_only");
        if (rolledBack || typeof versionId !== "string" || !UUID.test(versionId)) throw releaseUnavailable();
        rolledBack = true;
        try {
          const before = await port.currentDeployment();
          await execute("rollback", versionId);
          const after = await port.currentDeployment();
          // The answer is only the provider's own list: a NEW deployment of exactly the target version.
          if (after.versionId !== versionId || after.deploymentId === before.deploymentId) throw releaseUnavailable();
          return { deploymentId: after.deploymentId };
        } catch { throw releaseUnavailable(); }
      },
    };
    return port;
  } catch { throw unavailable(); }
}

function defaultRunner(wranglerPath: string, command: WranglerCommand): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(process.execPath, [wranglerPath, ...command.args], {
      // App ProcessEnv declares required Supabase keys; this isolated child intentionally omits them.
      cwd: command.cwd, env: command.env as NodeJS.ProcessEnv, windowsHide: true, timeout: 120_000,
      maxBuffer: MAX_STDOUT, encoding: "utf8",
    }, (error, stdout, stderr) => {
      resolve({ status: error ? 1 : 0, stdout, stderr });
    });
  });
}

/** Real Wrangler writes a "wrangler-session" record before the command's own record: drop it, and
 * leave the caller to require exactly one remaining record. */
function parseRecords(output: string): Record<string, unknown>[] {
  return output.trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((record) => record?.type !== "wrangler-session");
}

function boundedOutput(file: string): string {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_OUTPUT) throw unavailable();
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const initial = fstatSync(fd);
    if (!initial.isFile() || initial.size !== stat.size || initial.size > MAX_OUTPUT) throw unavailable();
    const buffer = Buffer.alloc(initial.size + 1);
    let total = 0;
    while (total < buffer.length) {
      const bytes = readSync(fd, buffer, total, buffer.length - total, total);
      if (!bytes) break;
      total += bytes;
    }
    if (total !== initial.size || fstatSync(fd).size !== initial.size) throw unavailable();
    return buffer.subarray(0, total).toString("utf8");
  } finally { closeSync(fd); }
}

function cleanupPrivateDirectory(directory: string): void {
  const actual = realpathSync(directory);
  if (actual !== path.resolve(directory) || path.dirname(actual) !== realpathSync(os.tmpdir())
    || !path.basename(actual).startsWith(PREFIX) || lstatSync(directory).isSymbolicLink()) throw unavailable();
  rmSync(actual, { recursive: true, force: true });
}
