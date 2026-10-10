import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = ["admin/login.html", "admin/index.html", "admin/security.html"];
const TEXT = /\.(?:html?|txt|css|js|mjs|json|svg|xml)$/i;
let policyPromise;

// Check every ancestor before opening any input, including the selected root.
// This rejects pre-existing links, not a hostile concurrent filesystem writer.
export function assertPlainPath(target) {
  const absolute = path.resolve(target);
  let cursor = path.parse(absolute).root;
  const parts = path.relative(cursor, absolute).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())) {
      throw new Error("linked_input");
    }
  }
}

export function assertPreviewStaging(stagingDir) {
  for (const relative of ["site", "meta", "meta/alias-worker-entry.mjs", "meta/crawl-report.json", "meta/verification-report.json", "meta/sitemap-verification.json", "meta/link-verification.json"]) {
    assertPlainPath(path.join(stagingDir, relative));
  }
  // Include empty directories: an existing admin namespace is never overlaid.
  if (readdirSync(path.join(stagingDir, "site")).some((name) => /^(?:admin|admin\.html)$/i.test(name))) {
    throw new Error("admin_route_collision");
  }
}

async function artifactPolicy() {
  if (!policyPromise) {
    register("./static-producer-loader.mjs", {
      parentURL: import.meta.url,
      data: { srcRoot: fileURLToPath(new URL("../../src", import.meta.url)) },
    });
    policyPromise = import("../../src/cloudflare/static-build/artifact-policy.ts");
  }
  return policyPromise;
}

export async function prepareAdminPreviewAssets(repoRoot, files) {
  const additions = [];
  for (const relativePath of FIXTURES) {
    const trackedPath = `fixtures/cloudflare-admin-assets/${relativePath}`;
    const source = path.join(repoRoot, trackedPath);
    assertPlainPath(source);
    const stat = lstatSync(source);
    if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw new Error("invalid_fixture");
    const git = spawnSync("git", ["ls-files", "--error-unmatch", "--", trackedPath], {
      cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 10_000,
    });
    if (git.status !== 0) throw new Error("untracked_fixture");
    additions.push({ relativePath, bytes: readFileSync(source) });
  }
  const combined = [...files, ...additions];
  const { validateArtifactPolicy } = await artifactPolicy();
  const result = validateArtifactPolicy(combined.map((file) => ({
    path: file.relativePath,
    size: file.bytes.length,
    ...(TEXT.test(file.relativePath) ? { text: file.bytes.toString("utf8") } : {}),
  })));
  if (!result.ok) throw new Error("artifact_policy_failed");
  return combined;
}
