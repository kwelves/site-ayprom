// Deploys the admin Worker to the STAGING Cloudflare address (ayprom-admin-staging on workers.dev) with the
// staging Supabase copy. NOT production: no production database, domain, DNS or Vercel is touched.
// Secrets are read from ~/.ayprom-secrets (created on first run where missing) and never printed.
// Usage: node scripts/cloudflare/admin-staging-deploy.mjs [--skip-build]
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STAGING_URL = "https://jpmoxtqafgbqihvjhvri.supabase.co";
const STAGING_PUBLISHABLE = "sb_publishable_yxS4_LQqsdPRtWxxUgg8-g_jQdYsJci"; // public by design
const ACCOUNT_ID = "5542d171bab5b5af3202e36e217f6ef9";
const SUBDOMAIN = "ayprom-migration";
const WORKER = "ayprom-admin-staging";
const WRANGLER = path.join(ROOT, ".wrangler/tools/wrangler-4.135.0/node_modules/wrangler/bin/wrangler.js");
const secretDir = path.join(os.homedir(), ".ayprom-secrets");
const read = (name) => readFileSync(path.join(secretDir, name), "utf8").trim();
function readOrCreate(name, create) {
  const file = path.join(secretDir, name);
  if (!existsSync(file)) writeFileSync(file, create(), { mode: 0o600 });
  return read(name);
}

const cloudflareToken = read("cloudflare-token.txt");
const stagingSecret = read("supabase-staging-secret-key.txt");
if (!STAGING_URL.startsWith("https://jpmoxtqafgbqihvjhvri.")) throw new Error("staging only");
// Stable across deployments, so a signed-in browser stays signed in. The staging admin password is kept in a file
// the owner can open; it is not printed here.
const sessionSecret = readOrCreate("admin-staging-session-secret.txt", () => randomBytes(32).toString("hex"));
const adminPassword = readOrCreate("admin-staging-password.txt", () => randomBytes(9).toString("base64url"));
// Optional: lets the admin start the background photo worker on GitHub (created by the owner, never printed).
const githubToken = existsSync(path.join(secretDir, "github-dispatch-token.txt")) ? read("github-dispatch-token.txt") : "";
const hidden = [cloudflareToken, stagingSecret, sessionSecret, adminPassword, githubToken].filter(Boolean);
const hide = (value) => hidden.reduce((text, secret) => text.replaceAll(secret, "[hidden]"), String(value));

function run(script, args, options = {}) {
  try {
    return execFileSync(process.execPath, [script, ...args], { cwd: ROOT, windowsHide: true, timeout: 600_000, stdio: ["ignore", "pipe", "pipe"], ...options });
  } catch (error) {
    throw new Error(hide(String(error.stderr ?? error.message)).slice(-1200));
  }
}

if (!process.argv.includes("--skip-build")) {
  run(path.join(ROOT, "node_modules/vite/bin/vite.js"), ["build", "--config", "vite.admin-spa.config.ts"]);
  run(path.join(ROOT, "scripts/cloudflare/build-admin-static-pages.mjs"), []);
}

// Start from the repository configuration (aliases, assets, flags) so staging runs exactly what is tested.
const base = JSON.parse(readFileSync(path.join(ROOT, "wrangler.admin-worker.jsonc"), "utf8").split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n"));
const absolute = (relative) => path.join(ROOT, relative.replace(/^\.\//, ""));
const dir = mkdtempSync(path.join(os.tmpdir(), "ayprom-admin-staging-"));
try {
  const config = {
    ...base,
    name: WORKER,
    account_id: ACCOUNT_ID,
    main: absolute(base.main),
    workers_dev: true,
    preview_urls: false,
    send_metrics: false,
    alias: Object.fromEntries(Object.entries(base.alias).map(([from, to]) => [from, absolute(to)])),
    assets: { ...base.assets, directory: absolute(base.assets.directory) },
    vars: {
      NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: STAGING_PUBLISHABLE,
      NODE_ENV: "production",
      // Catalog photos are served from here (the staging data is a copy of the real catalog); the admin's security
      // policy lets the browser load images from this address only.
      NEXT_PUBLIC_MEDIA_BASE_URL: "https://media.ayprom-gidravlika.kg",
      // Photos are processed in the background by the photo queue worker; this Worker only wakes it up.
      PHOTO_PROCESSING: "queue",
      GITHUB_REPOSITORY: "kwelves/site-ayprom",
      PHOTO_WORKFLOW_FILE: "photo-queue.yml",
      // Until the integration is merged, the workers' code is taken from the integration branch.
      PHOTO_WORKFLOW_REF: "cloudflare-integration-publish",
      // Edits wake the publication worker, which builds the public snapshot; the badge in the admin shows its state.
      PUBLICATION_WORKFLOW_FILE: "publish-site.yml",
      PUBLICATION_WORKFLOW_REF: "cloudflare-integration-publish",
    },
  };
  writeFileSync(path.join(dir, "wrangler.json"), JSON.stringify(config), { mode: 0o600 });
  writeFileSync(path.join(dir, "secrets.json"), JSON.stringify({
    SUPABASE_SECRET_KEY: stagingSecret,
    ADMIN_SESSION_SECRET: sessionSecret,
    ADMIN_PASSWORD: adminPassword,
    ...(githubToken ? { GITHUB_DISPATCH_TOKEN: githubToken } : {}),
  }), { mode: 0o600 });

  const env = { CLOUDFLARE_API_TOKEN: cloudflareToken, WRANGLER_SEND_METRICS: "false", CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false", CI: "true", NO_COLOR: "1", WRANGLER_LOG_PATH: path.join(dir, "wrangler.log") };
  for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"]) if (process.env[name]) env[name] = process.env[name];
  const output = run(WRANGLER, ["deploy", "--config", path.join(dir, "wrangler.json"), "--secrets-file", path.join(dir, "secrets.json"), "--message", "ayprom admin staging"], { cwd: dir, env });
  console.log(hide(String(output).split(/\r?\n/).filter((line) => /Total Upload|Deployed|Current Version|workers\.dev/i.test(line)).join("\n")));
  console.log(`admin staging address: https://${WORKER}.${SUBDOMAIN}.workers.dev/admin`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
