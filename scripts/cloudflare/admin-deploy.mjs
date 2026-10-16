// Deploys the admin Worker of one site: `staging` (the test copy) or `production` (the real site).
// Usage: node scripts/cloudflare/admin-deploy.mjs --target=staging|production [--skip-build] [--dry-run]
//          [--dual-write=true|false] [--workers-dev=on|off] [--confirm=<phrase for production>] [--keep-secrets]
// --dry-run assembles and checks everything and prints the plan (variable values, which secrets are present), but
// deploys nothing and sends nothing anywhere. Secrets are read from files in ~/.ayprom-secrets (never from the
// command line) and are never printed. What each target needs is in admin-targets.mjs.
// --keep-secrets is the automatic deployment (GitHub Actions) after a code change: it replaces only the code and the plain
// settings and leaves the secrets stored in Cloudflare as they are. Then no secret file is read; the Cloudflare token comes
// from CLOUDFLARE_API_TOKEN and the public settings from ADMIN_PUBLISHABLE_KEY and SENTRY_DSN (empty = no reporting).
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN_TARGETS, buildAdminDeployment } from "./admin-targets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ACCOUNT_ID = "5542d171bab5b5af3202e36e217f6ef9";
const SUBDOMAIN = "ayprom-migration";
const WRANGLER = path.join(ROOT, ".wrangler/tools/wrangler-4.135.0/node_modules/wrangler/bin/wrangler.js");

const args = process.argv.slice(2);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name) => args.includes(`--${name}`);
const targetName = option("target");
if (!targetName || !Object.hasOwn(ADMIN_TARGETS, targetName)) throw new Error("--target=staging or --target=production is required");
const target = ADMIN_TARGETS[targetName];
const dryRun = flag("dry-run");
const workersDev = (option("workers-dev") ?? "on") === "on";
const keepSecrets = flag("keep-secrets");

const secretDir = path.join(os.homedir(), ".ayprom-secrets");
const targetDir = targetName === "production" ? path.join(secretDir, "production") : secretDir;
const readIn = (directory, name) => {
  const file = path.join(directory, name);
  return existsSync(file) ? readFileSync(file, "utf8").trim() : undefined;
};
function readOrCreate(directory, name, create) {
  const file = path.join(directory, name);
  if (!existsSync(file)) {
    if (dryRun) return create(); // a dry run never writes: the value that would be created is only held in memory
    mkdirSync(directory, { recursive: true });
    writeFileSync(file, create(), { mode: 0o600 });
  }
  return readFileSync(file, "utf8").trim();
}

// Where each secret comes from. Staging keeps its original file names; production has its own folder.
// Production uses its own long-lived Workers token (production\cloudflare-token-publish.txt); the broad migration token
// is only a fallback while it still exists.
const cloudflareToken = keepSecrets
  ? process.env.CLOUDFLARE_API_TOKEN?.trim()
  : targetName === "production"
    ? readIn(targetDir, "cloudflare-token-publish.txt") ?? readIn(secretDir, "cloudflare-token-zone.txt")
    : readIn(secretDir, "cloudflare-token.txt");
const secretFiles = keepSecrets
  ? {}
  : targetName === "production"
  ? {
    SUPABASE_SECRET_KEY: readIn(targetDir, "supabase-secret-key.txt"),
    ADMIN_PASSWORD: readIn(targetDir, "admin-password.txt"),
    ADMIN_SESSION_SECRET: readOrCreate(targetDir, "admin-session-secret.txt", () => randomBytes(32).toString("hex")),
    GITHUB_DISPATCH_TOKEN: readIn(secretDir, "github-dispatch-token.txt"),
    R2_ACCOUNT_ID: readIn(targetDir, "r2-account-id.txt"),
    R2_ACCESS_KEY_ID: readIn(targetDir, "r2-access-key-id.txt"),
    R2_SECRET_ACCESS_KEY: readIn(targetDir, "r2-secret-access-key.txt"),
  }
  : {
    SUPABASE_SECRET_KEY: readIn(secretDir, "supabase-staging-secret-key.txt"),
    // Stable across deployments, so a signed-in browser stays signed in; the staging password is kept in a file the owner can open.
    ADMIN_SESSION_SECRET: readOrCreate(secretDir, "admin-staging-session-secret.txt", () => randomBytes(32).toString("hex")),
    ADMIN_PASSWORD: readOrCreate(secretDir, "admin-staging-password.txt", () => randomBytes(9).toString("base64url")),
    GITHUB_DISPATCH_TOKEN: readIn(secretDir, "github-dispatch-token.txt"),
  };
const publishableKey = keepSecrets
  ? process.env.ADMIN_PUBLISHABLE_KEY?.trim()
  : targetName === "production" ? readIn(targetDir, "supabase-publishable-key.txt") : undefined;
// Optional: the Sentry address of this site (public by design, so a plain variable, not a secret). No file, no reporting.
const sentryDsn = keepSecrets ? process.env.SENTRY_DSN?.trim() || undefined : readIn(targetDir, "sentry-dsn.txt");

const hidden = [cloudflareToken, ...Object.values(secretFiles)].filter(Boolean);
const hide = (value) => hidden.reduce((text, secret) => text.replaceAll(secret, "[hidden]"), String(value));

const deployment = buildAdminDeployment({
  target: targetName, secrets: secretFiles, publishableKey,
  dualWriteSupabase: option("dual-write"), confirm: option("confirm"), sentryDsn, keepSecrets,
});
if (!cloudflareToken) throw new Error("the Cloudflare token file is missing");

if (dryRun) {
  console.log(JSON.stringify({
    dryRun: true, target: targetName, worker: deployment.workerName, account: ACCOUNT_ID, workersDev,
    variables: deployment.vars, secretsPresent: Object.keys(deployment.secrets).sort(), keepSecrets,
  }, null, 2));
  process.exit(0);
}

function run(script, scriptArgs, options = {}) {
  try {
    return execFileSync(process.execPath, [script, ...scriptArgs], { cwd: ROOT, windowsHide: true, timeout: 600_000, stdio: ["ignore", "pipe", "pipe"], ...options });
  } catch (error) {
    throw new Error(hide(String(error.stderr ?? error.message)).slice(-1200));
  }
}
if (!flag("skip-build")) {
  run(path.join(ROOT, "node_modules/vite/bin/vite.js"), ["build", "--config", "vite.admin-spa.config.ts"]);
  run(path.join(ROOT, "scripts/cloudflare/build-admin-static-pages.mjs"), []);
}

// Start from the repository configuration (aliases, assets, cron trigger, flags) so the site runs exactly what is tested.
const base = JSON.parse(readFileSync(path.join(ROOT, "wrangler.admin-worker.jsonc"), "utf8").split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n"));
const absolute = (relative) => path.join(ROOT, relative.replace(/^\.\//, ""));
const dir = mkdtempSync(path.join(os.tmpdir(), `ayprom-admin-${targetName}-`));
try {
  const config = {
    ...base,
    name: deployment.workerName,
    account_id: ACCOUNT_ID,
    main: absolute(base.main),
    workers_dev: workersDev,
    preview_urls: false,
    send_metrics: false,
    alias: Object.fromEntries(Object.entries(base.alias).map(([from, to]) => [from, absolute(to)])),
    assets: { ...base.assets, directory: absolute(base.assets.directory) },
    vars: deployment.vars,
  };
  writeFileSync(path.join(dir, "wrangler.json"), JSON.stringify(config), { mode: 0o600 });
  if (!keepSecrets) writeFileSync(path.join(dir, "secrets.json"), JSON.stringify(deployment.secrets), { mode: 0o600 });

  const env = { CLOUDFLARE_API_TOKEN: cloudflareToken, WRANGLER_SEND_METRICS: "false", CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false", CI: "true", NO_COLOR: "1", WRANGLER_LOG_PATH: path.join(dir, "wrangler.log") };
  for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"]) if (process.env[name]) env[name] = process.env[name];
  const secretsArgs = keepSecrets ? [] : ["--secrets-file", path.join(dir, "secrets.json")];
  const output = run(WRANGLER, ["deploy", "--config", path.join(dir, "wrangler.json"), ...secretsArgs, "--message", `ayprom admin ${targetName}`], { cwd: dir, env });
  console.log(hide(String(output).split(/\r?\n/).filter((line) => /Total Upload|Deployed|Current Version|workers\.dev|schedule/i.test(line)).join("\n")));
  if (workersDev) {
    const address = `https://${deployment.workerName}.${SUBDOMAIN}.workers.dev`;
    let status = 0;
    for (let attempt = 0; attempt < 12 && status !== 200; attempt += 1) {
      status = (await fetch(`${address}/api/health`, { signal: AbortSignal.timeout(10_000) }).catch(() => null))?.status ?? 0;
      if (status !== 200) await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    console.log(`admin ${targetName} address: ${address}/admin  (health: ${status})`);
    if (status !== 200) process.exitCode = 1;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
