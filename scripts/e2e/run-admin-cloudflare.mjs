// Runs the existing admin e2e specs against the Cloudflare admin Worker, using the local Supabase and a
// local photo queue worker (the Node process that does the Sharp work in the background). Usage:
//   node scripts/e2e/run-admin-cloudflare.mjs [playwright args]
import { spawn, spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getVerifiedLocalRuntimeEnv, PROJECT_ROOT } from "./local-runtime.mjs";

const env = getVerifiedLocalRuntimeEnv();
const varsFile = path.join(PROJECT_ROOT, ".dev.vars.e2e");

// Local test keys only (local Supabase, fixed test password). The file is git-ignored and removed afterwards.
writeFileSync(varsFile, [
  `NEXT_PUBLIC_SUPABASE_URL=${env.NEXT_PUBLIC_SUPABASE_URL}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`,
  `SUPABASE_SECRET_KEY=${env.SUPABASE_SECRET_KEY}`,
  `ADMIN_PASSWORD=${env.ADMIN_PASSWORD}`,
  `ADMIN_SESSION_SECRET=${env.ADMIN_SESSION_SECRET}`,
  "PHOTO_PROCESSING=queue",
  "NODE_ENV=development",
  "",
].join("\n"));

const runNode = (script, args) => spawnSync(process.execPath, [script, ...args], { cwd: PROJECT_ROOT, env, stdio: "inherit", windowsHide: true });
let worker = null;
let status = 1;
try {
  for (const [script, args] of [
    [path.join(PROJECT_ROOT, "node_modules", "vite", "bin", "vite.js"), ["build", "--config", "vite.admin-spa.config.ts"]],
    [path.join(PROJECT_ROOT, "scripts", "cloudflare", "build-admin-static-pages.mjs"), []],
    [path.join(PROJECT_ROOT, "scripts", "cloudflare", "build-photo-queue.mjs"), []],
  ]) {
    const result = runNode(script, args);
    if (result.status !== 0) process.exit(result.status ?? 1);
  }

  // In production GitHub Actions starts this worker on demand; locally it simply keeps watching the queue.
  worker = spawn(process.execPath, [path.join(PROJECT_ROOT, "deploy", "photo-queue", "runner.mjs"), "--watch"], {
    cwd: PROJECT_ROOT,
    env,
    stdio: "inherit",
    windowsHide: true,
  });

  const result = runNode(path.join(PROJECT_ROOT, "node_modules", "playwright", "cli.js"), [
    "test", "--config", "playwright.admin-cloudflare.config.ts", "--project=admin", ...process.argv.slice(2),
  ]);
  status = result.status ?? 1;
} finally {
  worker?.kill();
  rmSync(varsFile, { force: true });
}
process.exit(status);
