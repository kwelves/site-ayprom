import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "deploy-admin.yml"), "utf8").replace(/\r\n/g, "\n");

describe("deploy-admin workflow: the admin Worker follows the code in main", () => {
  it("runs when code is merged into main, never for pull requests", () => {
    expect(workflow).toMatch(/^on:\s*$[\s\S]*^\s+push:\s*$[\s\S]*^\s+branches:\s*\[main\]/m);
    expect(workflow).not.toMatch(/^\s+pull_request/m);
    expect(workflow).not.toMatch(/pull_request_target/);
  });

  it("does not run for changes that cannot change the admin", () => {
    const ignored = /paths-ignore:\s*\n((?:\s+- .+\n)+)/.exec(workflow)?.[1] ?? "";
    for (const pattern of ["docs/**", "tests/**", "**/*.md", "supabase/**"]) expect(ignored).toContain(pattern);
  });

  it("deploys production for a push and the chosen site (staging by default) for a manual start", () => {
    const expression = "inputs.environment || (github.event_name == 'push' && 'production') || 'staging'";
    expect(workflow).toContain(`environment: \${{ ${expression} }}`);
    expect(workflow).toContain(`DEPLOY_TARGET: \${{ ${expression} }}`);
    expect(workflow).toContain(`group: deploy-admin-\${{ ${expression} }}`);
    expect(workflow).toMatch(/cancel-in-progress: false/);
  });

  it("keeps the secrets stored in Cloudflare and takes only the Cloudflare token and public settings from GitHub", () => {
    expect(workflow).toContain("--keep-secrets");
    expect(workflow).toContain("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}");
    expect(workflow).toContain("ADMIN_PUBLISHABLE_KEY: ${{ vars.SUPABASE_PUBLISHABLE_KEY }}");
    for (const secretName of ["SUPABASE_SECRET_KEY", "ADMIN_PASSWORD", "ADMIN_SESSION_SECRET", "GITHUB_DISPATCH_TOKEN", "R2_SECRET_ACCESS_KEY"]) {
      expect(workflow).not.toContain(`secrets.${secretName}`);
    }
  });

  it("passes the production dual-write decision and confirmation, and installs the pinned Wrangler", () => {
    expect(workflow).toContain("--dual-write=${{ vars.MEDIA_STORAGE_DUAL_WRITE_SUPABASE || 'false' }}");
    expect(workflow).toContain("--confirm=deploy-production-acyoyvetcyqmwppfenau");
    expect(workflow).toContain("wrangler@4.135.0");
  });

  it("supports a dry run that only checks the settings", () => {
    expect(workflow).toContain("dry_run:");
    expect(workflow).toContain("inputs.dry_run && '--dry-run'");
  });
});
