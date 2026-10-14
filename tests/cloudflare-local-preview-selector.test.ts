import { spawn } from "node:child_process";
import { closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectPackageInventory } from "../scripts/cloudflare/package-integrity.mjs";
import {
  previewSelectionStatus,
  rollbackPreviewPackage,
  selectPreviewPackage,
  usePreviewSelectorIoForTests,
} from "../scripts/cloudflare/local-preview-selector.mjs";

const CLI = path.resolve("scripts/cloudflare/local-preview-selector.mjs");
const temps: string[] = [];
afterEach(() => {
  usePreviewSelectorIoForTests(null);
  for (const directory of temps.splice(0)) rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "ayprom-preview-select-"));
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

describe("local preview selector", () => {
  it("selects the first verified package and leaves its bytes unchanged", () => {
    const repo = makeRepo();
    const pkg = makePackage(repo, "pkg-a");
    const before = packageBytes(pkg);
    expect(previewSelectionStatus({ repoRoot: repo })).toEqual({ ok: true, generation: 0, current: null, previous: null });
    expect(existsSync(selectionFile(repo))).toBe(false);
    expect(selectPreviewPackage({ repoRoot: repo, packageName: "pkg-a", expectedGeneration: 0 })).toEqual({
      ok: true, generation: 1, current: "pkg-a", previous: null,
    });
    expect(packageBytes(pkg)).toEqual(before);
    expect(existsSync(path.join(repo, "dist", "site"))).toBe(false);
  });

  it("moves A to B and rolls back to A after the previous package still verifies", () => {
    const repo = makeRepo();
    const first = makePackage(repo, "pkg-a");
    const second = makePackage(repo, "pkg-b");
    const beforeA = packageBytes(first);
    const beforeB = packageBytes(second);
    expect(selectPreviewPackage({ repoRoot: repo, packageName: "pkg-a", expectedGeneration: 0 }).generation).toBe(1);
    expect(selectPreviewPackage({ repoRoot: repo, packageName: "pkg-b", expectedGeneration: 1 })).toEqual({
      ok: true, generation: 2, current: "pkg-b", previous: "pkg-a",
    });
    expect(rollbackPreviewPackage({ repoRoot: repo, expectedGeneration: 2 })).toEqual({
      ok: true, generation: 3, current: "pkg-a", previous: "pkg-b",
    });
    expect(packageBytes(first)).toEqual(beforeA);
    expect(packageBytes(second)).toEqual(beforeB);
  });

  it("rejects a wrong generation without changing the selection or package bytes", () => {
    const repo = makeRepo();
    const pkg = makePackage(repo, "pkg-a");
    const before = packageBytes(pkg);
    selectPreviewPackage({ repoRoot: repo, packageName: "pkg-a", expectedGeneration: 0 });
    const selection = fileBytes(selectionFile(repo));
    expect(selectPreviewPackage({ repoRoot: repo, packageName: "pkg-a", expectedGeneration: 9 })).toEqual({
      ok: false, code: "generation_mismatch",
    });
    expect(fileBytes(selectionFile(repo))).toEqual(selection);
    expect(packageBytes(pkg)).toEqual(before);
  });

  it("lets only one of two same-generation selects win", async () => {
    const repo = makeRepo();
    makePackage(repo, "pkg-a");
    makePackage(repo, "pkg-b");
    const run = (name: string) => new Promise<{ stdout: string }>((resolve) => {
      const child = spawn(process.execPath, [CLI, "select", "--package", name, "--generation", "0"], { cwd: repo, windowsHide: true });
      let stdout = "";
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.on("close", () => resolve({ stdout }));
    });
    const [left, right] = await Promise.all([run("pkg-a"), run("pkg-b")]);
    const parsed = [left, right].map((item) => JSON.parse(item.stdout));
    expect(parsed.filter((item) => item.ok)).toHaveLength(1);
    const state = JSON.parse(fileBytes(selectionFile(repo)).toString("utf8"));
    expect(state.generation).toBe(1);
    expect(["pkg-a", "pkg-b"]).toContain(state.current);
    expect(state.previous).toBeNull();
  });

  it("rejects a damaged candidate and keeps the previous selection", () => {
    const repo = makeRepo();
    const current = makePackage(repo, "pkg-a");
    const damaged = makePackage(repo, "pkg-b");
    writeFileSync(path.join(damaged, "package-manifest.json"), JSON.stringify({
      kind: "admin-preview", ready: false, previewReady: true, productionReady: false,
    }));
    selectPreviewPackage({ repoRoot: repo, packageName: "pkg-a", expectedGeneration: 0 });
    const selection = fileBytes(selectionFile(repo));
    const before = packageBytes(current);
    const result = selectPreviewPackage({ repoRoot: repo, packageName: "pkg-b", expectedGeneration: 1 });
    expect(result).toMatchObject({ ok: false, code: "package_rejected", rule: "missing_inventory" });
    expect(JSON.stringify(result)).not.toContain("sb_secret");
    expect(fileBytes(selectionFile(repo))).toEqual(selection);
    expect(packageBytes(current)).toEqual(before);
  });

  it("rejects rollback when the previous package changed and keeps the current choice", () => {
    const repo = makeRepo();
    const first = makePackage(repo, "pkg-a");
    const second = makePackage(repo, "pkg-b");
    selectPreviewPackage({ repoRoot: repo, packageName: "pkg-a", expectedGeneration: 0 });
    selectPreviewPackage({ repoRoot: repo, packageName: "pkg-b", expectedGeneration: 1 });
    writeFileSync(path.join(first, "worker.js"), "tampered-worker-secret");
    const selection = fileBytes(selectionFile(repo));
    const currentBytes = packageBytes(second);
    const previousBytes = fileBytes(path.join(first, "worker.js"));
    const result = rollbackPreviewPackage({ repoRoot: repo, expectedGeneration: 2 });
    expect(result).toMatchObject({ ok: false, code: "package_rejected" });
    expect(JSON.stringify(result)).not.toContain("tampered-worker-secret");
    expect(fileBytes(selectionFile(repo))).toEqual(selection);
    expect(packageBytes(second)).toEqual(currentBytes);
    expect(fileBytes(path.join(first, "worker.js"))).toEqual(previousBytes);
  });

  it("does not replace malformed or oversized selection state", () => {
    const repo = makeRepo();
    makePackage(repo, "pkg-a");
    mkdirSync(path.join(repo, "dist", "local-preview"), { recursive: true });
    const file = selectionFile(repo);
    writeFileSync(file, "{not-json secret-state-body");
    const malformed = fileBytes(file);
    const status = previewSelectionStatus({ repoRoot: repo });
    expect(status).toMatchObject({ ok: false, code: "selection_invalid", rule: "malformed" });
    expect(JSON.stringify(status)).not.toContain("secret-state-body");
    expect(selectPreviewPackage({ repoRoot: repo, packageName: "pkg-a", expectedGeneration: 0 }).ok).toBe(false);
    expect(fileBytes(file)).toEqual(malformed);
    writeFileSync(file, "secret-oversized-state");
    const handle = openSync(file, "r+");
    ftruncateSync(handle, 64 * 1024 + 1);
    closeSync(handle);
    const oversized = fileBytes(file);
    const oversizedStatus = previewSelectionStatus({ repoRoot: repo });
    expect(oversizedStatus).toMatchObject({ ok: false, code: "selection_invalid", rule: "byte_limit" });
    expect(JSON.stringify(oversizedStatus)).not.toContain("secret-oversized-state");
    expect(selectPreviewPackage({ repoRoot: repo, packageName: "pkg-a", expectedGeneration: 0 }).ok).toBe(false);
    expect(fileBytes(file)).toEqual(oversized);
  });

  it("rejects a junction package without reading or writing outside", () => {
    const repo = makeRepo();
    const outside = tempDir();
    writeFileSync(path.join(outside, "marker.txt"), "junction-secret");
    const link = path.join(repo, "dist", "worker-packages", "linked");
    symlinkSync(outside, link, "junction");
    const result = selectPreviewPackage({ repoRoot: repo, packageName: "linked", expectedGeneration: 0 });
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain("junction-secret");
    expect(fileBytes(path.join(outside, "marker.txt")).toString("utf8")).toBe("junction-secret");
    expect(existsSync(path.join(outside, "selection.json"))).toBe(false);
    expect(existsSync(selectionFile(repo))).toBe(false);
  });

  it("keeps the same generation when the current package is selected again", () => {
    const repo = makeRepo();
    const pkg = makePackage(repo, "pkg-a");
    const before = packageBytes(pkg);
    selectPreviewPackage({ repoRoot: repo, packageName: "pkg-a", expectedGeneration: 0 });
    const selection = fileBytes(selectionFile(repo));
    const again = selectPreviewPackage({ repoRoot: repo, packageName: "pkg-a", expectedGeneration: 1 });
    expect(again).toEqual({ ok: true, generation: 1, current: "pkg-a", previous: null });
    expect(fileBytes(selectionFile(repo))).toEqual(selection);
    expect(previewSelectionStatus({ repoRoot: repo })).toEqual({ ok: true, generation: 1, current: "pkg-a", previous: null });
    expect(packageBytes(pkg)).toEqual(before);
  });

  it("refuses to advance past the largest safe generation for select and rollback", () => {
    const repo = makeRepo();
    const first = makePackage(repo, "pkg-a");
    const second = makePackage(repo, "pkg-b");
    mkdirSync(path.join(repo, "dist", "local-preview"), { recursive: true });
    const file = selectionFile(repo);
    writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, generation: Number.MAX_SAFE_INTEGER, current: "pkg-a", previous: "pkg-b" })}\n`);
    const selection = fileBytes(file);
    const beforeA = packageBytes(first);
    const beforeB = packageBytes(second);
    const selected = selectPreviewPackage({ repoRoot: repo, packageName: "pkg-b", expectedGeneration: Number.MAX_SAFE_INTEGER });
    expect(selected).toEqual({ ok: false, code: "generation_overflow" });
    expect(fileBytes(file)).toEqual(selection);
    expect(previewSelectionStatus({ repoRoot: repo })).toEqual({
      ok: true, generation: Number.MAX_SAFE_INTEGER, current: "pkg-a", previous: "pkg-b",
    });
    const rolled = rollbackPreviewPackage({ repoRoot: repo, expectedGeneration: Number.MAX_SAFE_INTEGER });
    expect(rolled).toEqual({ ok: false, code: "generation_overflow" });
    expect(fileBytes(file)).toEqual(selection);
    expect(packageBytes(first)).toEqual(beforeA);
    expect(packageBytes(second)).toEqual(beforeB);
  });

  it("does not remove or rewrite a lock owned by someone else", () => {
    const repo = makeRepo();
    const pkg = makePackage(repo, "pkg-a");
    const before = packageBytes(pkg);
    selectPreviewPackage({ repoRoot: repo, packageName: "pkg-a", expectedGeneration: 0 });
    const selection = fileBytes(selectionFile(repo));
    const lock = path.join(repo, "dist", "local-preview", "selection.lock");
    writeFileSync(lock, "foreign-lock-marker");
    const lockBytes = fileBytes(lock);
    const result = selectPreviewPackage({ repoRoot: repo, packageName: "pkg-a", expectedGeneration: 1 });
    expect(result).toEqual({ ok: false, code: "lock_held" });
    expect(fileBytes(lock)).toEqual(lockBytes);
    expect(existsSync(lock)).toBe(true);
    expect(fileBytes(selectionFile(repo))).toEqual(selection);
    expect(packageBytes(pkg)).toEqual(before);
  });

  it.each(["EPERM", "EACCES"])("keeps the old selection when replacing it fails with %s", (code) => {
    const repo = makeRepo();
    const first = makePackage(repo, "pkg-a");
    const second = makePackage(repo, "pkg-b");
    const beforeA = packageBytes(first);
    const beforeB = packageBytes(second);
    selectPreviewPackage({ repoRoot: repo, packageName: "pkg-a", expectedGeneration: 0 });
    const selection = fileBytes(selectionFile(repo));
    usePreviewSelectorIoForTests({
      renameSync() {
        const error = new Error("secret-disk-failure") as NodeJS.ErrnoException;
        error.code = code;
        throw error;
      },
    });
    const result = selectPreviewPackage({ repoRoot: repo, packageName: "pkg-b", expectedGeneration: 1 });
    expect(result).toEqual({ ok: false, code: "selection_write_failed" });
    expect(JSON.stringify(result)).not.toContain("secret-disk-failure");
    expect(existsSync(selectionFile(repo))).toBe(true);
    expect(fileBytes(selectionFile(repo))).toEqual(selection);
    expect(previewSelectionStatus({ repoRoot: repo })).toEqual({ ok: true, generation: 1, current: "pkg-a", previous: null });
    expect(packageBytes(first)).toEqual(beforeA);
    expect(packageBytes(second)).toEqual(beforeB);
  });
});
