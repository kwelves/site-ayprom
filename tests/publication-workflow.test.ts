import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "publish-site.yml"), "utf8").replace(/\r\n/g, "\n");

describe("publish-site workflow: automatic publication after code changes", () => {
  it("runs when code is merged into main, and only there", () => {
    expect(workflow).toMatch(/^on:\s*$[\s\S]*^\s+push:\s*$[\s\S]*^\s+branches:\s*\[main\]/m);
    expect(workflow).not.toMatch(/^\s+pull_request/m);
    expect(workflow).not.toMatch(/pull_request_target/);
  });

  it("does not run for changes that cannot change the public site", () => {
    const ignored = /paths-ignore:\s*\n((?:\s+- .+\n)+)/.exec(workflow)?.[1] ?? "";
    for (const pattern of ["docs/**", "tests/**", "**/*.md", "supabase/**"]) expect(ignored).toContain(pattern);
  });

  it("publishes the production site for a push, and the chosen one (staging by default) for a manual start", () => {
    const expression = "inputs.environment || (github.event_name == 'push' && 'production') || 'staging'";
    expect(workflow).toContain(`environment: \${{ ${expression} }}`);
    expect(workflow).toContain(`PUBLICATION_TARGET: \${{ ${expression} }}`);
    expect(workflow).toContain(`group: publish-site-\${{ ${expression} }}`);
  });

  it("rebuilds the site even when no content changed, for a push and on request, and never cancels a running publication", () => {
    expect(workflow).toContain("force_rebuild:");
    expect(workflow).toMatch(/PUBLICATION_FORCE_REBUILD: \$\{\{ \(github\.event_name == 'push' \|\| inputs\.force_rebuild\) && 'yes' \|\| 'no' \}\}/);
    expect(workflow).toMatch(/cancel-in-progress: false/);
  });

  it("keeps the dry run free of the browser install", () => {
    expect(workflow).toContain("if: ${{ !inputs.dry_run }}");
  });
});
