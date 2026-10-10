import { defineConfig } from "@playwright/test";
import path from "node:path";
import base from "./playwright.config";

// The existing admin e2e specs, run against the Cloudflare admin Worker (wrangler dev) instead of
// `next start`. Same local Supabase, same assertions: this is the "behaves as before" check.
const port = Number(process.env.E2E_PORT ?? 3101);
const wranglerBinary = path.join(process.cwd(), ".wrangler", "tools", "wrangler-4.135.0", "node_modules", "wrangler", "bin", "wrangler.js");

export default defineConfig({
  ...base,
  webServer: {
    command: `"${process.execPath}" "${wranglerBinary}" dev --config wrangler.admin-worker.jsonc --env e2e --port ${port} --ip 127.0.0.1 --local`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: (base.projects ?? []).filter((project) => ["auth-setup", "auth-cleanup", "admin"].includes(project.name ?? "")),
});
