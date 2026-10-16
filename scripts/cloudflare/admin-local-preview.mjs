// Local preview of the admin for design work: the same admin Worker and app as in production, on this computer, against
// the local Supabase (test data, fixed test password). The app is rebuilt on every source change (vite build --watch);
// reload the page to see it. Usage: node scripts/cloudflare/admin-local-preview.mjs  (port: E2E_PORT, default 3101)
// Only local addresses and local test keys are used; the vars file is git-ignored and removed on exit.
import { spawn, spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getE2EPort, getVerifiedLocalRuntimeEnv, PROJECT_ROOT } from "../e2e/local-runtime.mjs";

process.chdir(PROJECT_ROOT);
const env = getVerifiedLocalRuntimeEnv();
const port = getE2EPort();
const varsFile = path.join(PROJECT_ROOT, ".dev.vars.e2e");
writeFileSync(varsFile, [
  `NEXT_PUBLIC_SUPABASE_URL=${env.NEXT_PUBLIC_SUPABASE_URL}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`,
  `SUPABASE_SECRET_KEY=${env.SUPABASE_SECRET_KEY}`,
  `NEXT_PUBLIC_MEDIA_BASE_URL=${env.NEXT_PUBLIC_SUPABASE_URL}`,
  `ADMIN_PASSWORD=${env.ADMIN_PASSWORD}`,
  `ADMIN_SESSION_SECRET=${env.ADMIN_SESSION_SECRET}`,
  "PHOTO_PROCESSING=queue",
  "NODE_ENV=development",
  "",
].join("\n"));

const node = (script, args, options = {}) => [process.execPath, [script, ...args], { cwd: PROJECT_ROOT, env, windowsHide: true, ...options }];
const vite = path.join(PROJECT_ROOT, "node_modules", "vite", "bin", "vite.js");
const wrangler = path.join(PROJECT_ROOT, ".wrangler", "tools", "wrangler-4.135.0", "node_modules", "wrangler", "bin", "wrangler.js");

for (const [script, args] of [[vite, ["build", "--config", "vite.admin-spa.config.ts"]], [path.join(PROJECT_ROOT, "scripts", "cloudflare", "build-admin-static-pages.mjs"), []]]) {
  const result = spawnSync(...node(script, args, { stdio: "inherit" }));
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const children = [
  // Rebuilds dist/admin-spa on change; emptyOutDir off so the static pages written above stay.
  spawn(...node(vite, ["build", "--config", "vite.admin-spa.config.ts", "--watch", "--emptyOutDir=false"], { stdio: "inherit" })),
  spawn(...node(wrangler, ["dev", "--config", "wrangler.admin-worker.jsonc", "--env", "e2e", "--port", String(port), "--ip", "127.0.0.1", "--local", "--show-interactive-dev-session=false"], { stdio: "inherit" })),
];
const stop = () => { for (const child of children) child.kill(); rmSync(varsFile, { force: true }); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) child.on("exit", stop);
