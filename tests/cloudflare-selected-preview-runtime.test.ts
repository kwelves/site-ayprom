import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { collectPackageInventory } from "../scripts/cloudflare/package-integrity.mjs";
import { readAdminPreviewRuntime } from "../scripts/cloudflare/admin-preview-runtime.mjs";
import { selectPreviewPackage } from "../scripts/cloudflare/local-preview-selector.mjs";
import { resolveSelectedAdminPreview } from "../scripts/cloudflare/resolve-selected-admin-preview.mjs";

const temps: string[] = [];
afterEach(() => {
  for (const directory of temps.splice(0)) rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "ayprom-selected-preview-"));
  temps.push(directory);
  return directory;
}

function makeRepo(): string {
  const root = tempDir();
  mkdirSync(path.join(root, "dist", "worker-packages"), { recursive: true });
  return root;
}

function selectionFile(repo: string): string {
  return path.join(repo, "dist", "local-preview", "selection.json");
}

function makePackage(repo: string, name: string) {
  const directory = path.join(repo, "dist", "worker-packages", name);
  mkdirSync(path.join(directory, "site"), { recursive: true });
  writeFileSync(path.join(directory, "worker.js"), `export default { id: ${JSON.stringify(name)} };`);
  writeFileSync(path.join(directory, "site", "index.html"), `<p>${name}</p>`);
  writeFileSync(path.join(directory, "wrangler.jsonc"), JSON.stringify({
    main: "worker.js",
    compatibility_date: "2026-09-19",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    assets: {
      directory: "site",
      binding: "ASSETS",
      html_handling: "drop-trailing-slash",
      not_found_handling: "404-page",
      run_worker_first: ["/api/*", "/product/*", "/admin", "/admin/*"],
    },
  }));
  const inventory = collectPackageInventory(directory);
  writeFileSync(path.join(directory, "package-manifest.json"), JSON.stringify({
    kind: "admin-preview",
    ready: false,
    previewReady: true,
    productionReady: false,
    inventory: inventory.inventory,
  }));
  return directory;
}

function fileBytes(file: string): Buffer {
  return readFileSync(file);
}

function packageBytes(directory: string) {
  return {
    worker: fileBytes(path.join(directory, "worker.js")),
    html: fileBytes(path.join(directory, "site", "index.html")),
    manifest: fileBytes(path.join(directory, "package-manifest.json")),
    config: fileBytes(path.join(directory, "wrangler.jsonc")),
  };
}

describe("selected admin preview resolution", () => {
  it("resolves a dotted package name accepted by the selector", () => {
    const repo = makeRepo();
    const pkg = makePackage(repo, "pkg..a");
    expect(selectPreviewPackage({ repoRoot: repo, packageName: "pkg..a", expectedGeneration: 0 }).ok).toBe(true);
    const result = resolveSelectedAdminPreview({ repoRoot: repo, expectedGeneration: 1 });
    expect(result).toMatchObject({ ok: true, generation: 1, packageName: "pkg..a" });
    expect(result.runtime.main).toBe(path.join(pkg, "worker.js"));
  });
  it("returns the checked runtime config without changing files", () => {
    const repo = makeRepo();
    const pkg = makePackage(repo, "pkg-a");
    selectPreviewPackage({ repoRoot: repo, packageName: "pkg-a", expectedGeneration: 0 });
    const beforePackage = packageBytes(pkg);
    const beforeSelection = fileBytes(selectionFile(repo));
    const result = resolveSelectedAdminPreview({ repoRoot: repo, expectedGeneration: 1 });
    expect(result.ok).toBe(true);
    expect(result.generation).toBe(1);
    expect(result.packageName).toBe("pkg-a");
    expect(result.runtime.main).toBe(path.join(pkg, "worker.js"));
    expect(result.runtime.assets.directory).toBe(path.join(pkg, "site"));
    expect(result.runtime).not.toHaveProperty("vars");
    expect(packageBytes(pkg)).toEqual(beforePackage);
    expect(fileBytes(selectionFile(repo))).toEqual(beforeSelection);
    expect(existsSync(path.join(repo, "dist", "site"))).toBe(false);
  });

  it("refuses when nothing is selected", () => {
    const repo = makeRepo();
    const result = resolveSelectedAdminPreview({ repoRoot: repo, expectedGeneration: 0 });
    expect(result).toEqual({ ok: false, code: "selection_missing" });
    expect(existsSync(selectionFile(repo))).toBe(false);
  });

  it("refuses a wrong generation without changing files", () => {
    const repo = makeRepo();
    const pkg = makePackage(repo, "pkg-a");
    selectPreviewPackage({ repoRoot: repo, packageName: "pkg-a", expectedGeneration: 0 });
    const beforePackage = packageBytes(pkg);
    const beforeSelection = fileBytes(selectionFile(repo));
    const result = resolveSelectedAdminPreview({ repoRoot: repo, expectedGeneration: 2 });
    expect(result).toEqual({ ok: false, code: "generation_mismatch" });
    expect(packageBytes(pkg)).toEqual(beforePackage);
    expect(fileBytes(selectionFile(repo))).toEqual(beforeSelection);
  });

  it("refuses a damaged or missing package without rewriting the selection", () => {
    const repo = makeRepo();
    const pkg = makePackage(repo, "pkg-a");
    selectPreviewPackage({ repoRoot: repo, packageName: "pkg-a", expectedGeneration: 0 });
    writeFileSync(path.join(pkg, "package-manifest.json"), JSON.stringify({
      kind: "admin-preview", ready: false, previewReady: true, productionReady: false,
    }));
    const damaged = packageBytes(pkg);
    const selection = fileBytes(selectionFile(repo));
    const missingInventory = resolveSelectedAdminPreview({ repoRoot: repo, expectedGeneration: 1 });
    expect(missingInventory).toMatchObject({ ok: false, code: "package_rejected", rule: "missing_inventory" });
    expect(JSON.stringify(missingInventory)).not.toContain("sb_secret");
    expect(packageBytes(pkg)).toEqual(damaged);
    expect(fileBytes(selectionFile(repo))).toEqual(selection);

    rmSync(pkg, { recursive: true, force: true });
    const missing = resolveSelectedAdminPreview({ repoRoot: repo, expectedGeneration: 1 });
    expect(missing).toMatchObject({ ok: false, code: "package_rejected" });
    expect(fileBytes(selectionFile(repo))).toEqual(selection);
  });

  it("refuses a junction package without reading its target", () => {
    const repo = makeRepo();
    const outside = tempDir();
    writeFileSync(path.join(outside, "marker.txt"), "junction-secret");
    const link = path.join(repo, "dist", "worker-packages", "linked");
    expect(spawnSync("cmd", ["/c", "mklink", "/J", link, outside], { windowsHide: true }).status).toBe(0);
    mkdirSync(path.join(repo, "dist", "local-preview"), { recursive: true });
    writeFileSync(selectionFile(repo), `${JSON.stringify({ schemaVersion: 1, generation: 1, current: "linked", previous: null })}\n`);
    const selection = fileBytes(selectionFile(repo));
    const result = resolveSelectedAdminPreview({ repoRoot: repo, expectedGeneration: 1 });
    expect(result).toMatchObject({ ok: false, code: "package_rejected" });
    expect(JSON.stringify(result)).not.toContain("junction-secret");
    expect(fileBytes(path.join(outside, "marker.txt")).toString("utf8")).toBe("junction-secret");
    expect(fileBytes(selectionFile(repo))).toEqual(selection);
  });

  it("refuses a malformed selection without rewriting it", () => {
    const repo = makeRepo();
    mkdirSync(path.join(repo, "dist", "local-preview"), { recursive: true });
    writeFileSync(selectionFile(repo), "{not-json secret-state-body");
    const selection = fileBytes(selectionFile(repo));
    const result = resolveSelectedAdminPreview({ repoRoot: repo, expectedGeneration: 1 });
    expect(result).toMatchObject({ ok: false, code: "selection_invalid", rule: "malformed" });
    expect(JSON.stringify(result)).not.toContain("secret-state-body");
    expect(fileBytes(selectionFile(repo))).toEqual(selection);
  });

  it("refuses when the selection changes during the package check", () => {
    const repo = makeRepo();
    const first = makePackage(repo, "pkg-a");
    const second = makePackage(repo, "pkg-b");
    selectPreviewPackage({ repoRoot: repo, packageName: "pkg-a", expectedGeneration: 0 });
    const beforeA = packageBytes(first);
    const beforeB = packageBytes(second);
    const changed = `${JSON.stringify({ schemaVersion: 1, generation: 2, current: "pkg-b", previous: "pkg-a" })}\n`;
    const result = resolveSelectedAdminPreview({ repoRoot: repo, expectedGeneration: 1 }, {
      readRuntime(directory: string) {
        writeFileSync(selectionFile(repo), changed);
        return readAdminPreviewRuntime(directory);
      },
    });
    expect(result).toEqual({ ok: false, code: "selection_changed" });
    expect(fileBytes(selectionFile(repo)).toString("utf8")).toBe(changed);
    expect(packageBytes(first)).toEqual(beforeA);
    expect(packageBytes(second)).toEqual(beforeB);
  });
});
