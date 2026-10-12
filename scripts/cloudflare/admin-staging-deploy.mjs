// Deploys the admin Worker to the STAGING Cloudflare address (ayprom-admin-staging on workers.dev) with the staging
// Supabase copy. NOT production: no production database, domain, DNS or Vercel is touched.
// This is a thin wrapper around the shared script; see admin-deploy.mjs and admin-targets.mjs.
// Usage: node scripts/cloudflare/admin-staging-deploy.mjs [--skip-build] [--dry-run]
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const result = spawnSync(process.execPath, [path.join(here, "admin-deploy.mjs"), "--target=staging", ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(result.status ?? 1);
