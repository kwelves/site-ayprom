import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync, type PathLike, type Stats } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectPackageInventory, verifyPackageIntegrity } from "../scripts/cloudflare/package-integrity.mjs";
import { readAdminPreviewRuntime } from "../scripts/cloudflare/admin-preview-runtime.mjs";

const CLI = path.resolve("scripts/cloudflare/verify-package-integrity.mjs");
const temps: string[] = [];
afterEach(() => {
  for (const directory of temps.splice(0)) rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "ayprom-integrity-"));
  temps.push(directory);
  return directory;
}

function oversizedStat(stat: Stats, limit: number): Stats {
  return new Proxy(stat, {
    get(obj, prop, receiver) {
      if (prop === "size") return limit + 1;
      const value: unknown = Reflect.get(obj, prop, receiver);
      return typeof value === "function" ? value.bind(obj) : value;
    },
  });
}

function writePackage(root: string, files: Record<string, string> = { "worker.js": "worker", "wrangler.jsonc": "{}\n", "site/index.html": "<p>home</p>" }) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const file = path.join(root, relativePath);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
}

async function seal(root: string, extra: Record<string, unknown> = {}) {
  const inventory = await collectPackageInventory(root);
  expect(inventory.ok).toBe(true);
  writeFileSync(path.join(root, "package-manifest.json"), `${JSON.stringify({ schemaVersion: 1, ready: true, inventory: inventory.inventory, ...extra }, null, 2)}\n`);
  return inventory;
}

function junction(link: string, target: string) {
  // A junction on Windows, a plain symbolic link elsewhere: both are links the code under test must refuse to follow.
  fs.symlinkSync(target, link, "junction");
}

describe("package integrity", () => {
  it("accepts an untouched package and ignores the manifest itself", async () => {
    const root = tempDir();
    writePackage(root);
    const inventory = await seal(root);
    expect(inventory.inventory.files.map((file: { path: string }) => file.path)).toEqual(["site/index.html", "worker.js", "wrangler.jsonc"]);
    expect(JSON.stringify(inventory)).not.toContain("package-manifest.json");
    const before = statSync(path.join(root, "worker.js")).mtimeMs;
    const result = await verifyPackageIntegrity(root);
    expect(result).toEqual({ ok: true });
    expect(statSync(path.join(root, "worker.js")).mtimeMs).toBe(before);
  });

  it("rejects a changed worker, config, or html file without echoing its contents", async () => {
    const root = tempDir();
    writePackage(root);
    await seal(root);
    writeFileSync(path.join(root, "worker.js"), "tampered-worker-secret");
    const worker = await verifyPackageIntegrity(root);
    expect(worker).toEqual({ ok: false, code: "package_integrity_failed", rule: "changed_file" });
    expect(JSON.stringify(worker)).not.toContain("tampered-worker-secret");
    writeFileSync(path.join(root, "worker.js"), "worker");
    writeFileSync(path.join(root, "wrangler.jsonc"), "{ \"mutated\": true }\n");
    expect(await verifyPackageIntegrity(root)).toMatchObject({ ok: false, rule: "changed_file" });
    writeFileSync(path.join(root, "wrangler.jsonc"), "{}\n");
    writeFileSync(path.join(root, "site/index.html"), "<p>secret-html</p>");
    const html = await verifyPackageIntegrity(root);
    expect(html).toMatchObject({ ok: false, rule: "changed_file" });
    expect(JSON.stringify(html)).not.toContain("secret-html");
  });

  it("rejects an added file, a missing file, and an empty site", async () => {
    const root = tempDir();
    writePackage(root);
    await seal(root);
    writeFileSync(path.join(root, "site/extra.html"), "extra");
    expect(await verifyPackageIntegrity(root)).toMatchObject({ ok: false, rule: "extra_file" });
    rmSync(path.join(root, "site/extra.html"));
    rmSync(path.join(root, "site/index.html"));
    expect(await verifyPackageIntegrity(root)).toMatchObject({ ok: false, rule: "missing_file" });
    const empty = tempDir();
    writePackage(empty, { "worker.js": "worker", "wrangler.jsonc": "{}\n" });
    mkdirSync(path.join(empty, "site"));
    await seal(empty);
    expect(await verifyPackageIntegrity(empty)).toMatchObject({ ok: false, rule: "empty_site" });
  });

  it("rejects unsafe inventory paths without reading outside the package", async () => {
    const root = tempDir();
    const outside = tempDir();
    writeFileSync(path.join(outside, "secret.txt"), "outside-secret-value");
    writePackage(root);
    const inventory = await collectPackageInventory(root);
    inventory.inventory.files.push({ path: "../secret.txt", bytes: 1, sha256: "ab" });
    writeFileSync(path.join(root, "package-manifest.json"), JSON.stringify({ inventory: inventory.inventory }));
    const result = await verifyPackageIntegrity(root);
    expect(result).toMatchObject({ ok: false, rule: "unsafe_path" });
    expect(JSON.stringify(result)).not.toContain("outside-secret-value");
    expect(readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("outside-secret-value");
  });

  it("rejects a junction parent or child without following it", async () => {
    const outside = tempDir();
    writeFileSync(path.join(outside, "secret.txt"), "junction-secret");
    const parentLink = tempDir();
    rmSync(parentLink, { recursive: true, force: true });
    junction(parentLink, outside);
    const parentResult = await verifyPackageIntegrity(path.join(parentLink, "missing-package"));
    expect(parentResult).toMatchObject({ ok: false, rule: "symlink" });
    expect(JSON.stringify(parentResult)).not.toContain("junction-secret");

    const root = tempDir();
    writePackage(root);
    const child = path.join(root, "site", "linked");
    junction(child, outside);
    const childResult = await verifyPackageIntegrity(root);
    expect(childResult).toMatchObject({ ok: false, rule: "symlink" });
    expect(JSON.stringify(childResult)).not.toContain("junction-secret");
  });

  it("rejects case collisions, device names, and too many bytes before reading them", async () => {
    const collision = tempDir();
    writePackage(collision);
    const inventory = await collectPackageInventory(collision);
    inventory.inventory.files.push({ path: "site/INDEX.html", bytes: 1, sha256: "aa" });
    writeFileSync(path.join(collision, "package-manifest.json"), JSON.stringify({ inventory: inventory.inventory }));
    expect(await verifyPackageIntegrity(collision)).toMatchObject({ ok: false, rule: "case_collision" });

    const device = tempDir();
    writePackage(device);
    const deviceInventory = await collectPackageInventory(device);
    deviceInventory.inventory.files.push({ path: "site/NUL.txt", bytes: 1, sha256: "aa" });
    writeFileSync(path.join(device, "package-manifest.json"), JSON.stringify({ inventory: deviceInventory.inventory }));
    expect(await verifyPackageIntegrity(device)).toMatchObject({ ok: false, rule: "device_name" });

    const huge = tempDir();
    writePackage(huge, { "worker.js": "worker", "wrangler.jsonc": "{}\n", "site/index.html": "x" });
    const big = path.join(huge, "site/big.bin");
    const handle = openSync(big, "w");
    ftruncateSync(handle, 25 * 1024 * 1024 + 1);
    closeSync(handle);
    expect(await verifyPackageIntegrity(huge)).toMatchObject({ ok: false, rule: "byte_limit" });
  });

  it("rejects a preview runtime without inventory and forged release flags", async () => {
    const missing = tempDir();
    writePackage(missing, {
      "worker.js": "export default {};",
      "wrangler.jsonc": JSON.stringify({
        main: "worker.js", compatibility_date: "2026-09-19", compatibility_flags: ["nodejs_compat"], workers_dev: false,
        assets: { directory: "site", binding: "ASSETS", html_handling: "drop-trailing-slash", not_found_handling: "404-page", run_worker_first: ["/api/*", "/product/*", "/admin", "/admin/*"] },
      }),
      "site/index.html": "<p>admin</p>",
    });
    writeFileSync(path.join(missing, "package-manifest.json"), JSON.stringify({
      kind: "admin-preview", ready: false, previewReady: true, productionReady: false,
    }));
    expect(() => readAdminPreviewRuntime(missing)).toThrow("missing_inventory");

    const forged = tempDir();
    writePackage(forged, {
      "worker.js": "export default {};",
      "wrangler.jsonc": JSON.stringify({
        main: "worker.js", compatibility_date: "2026-09-19", compatibility_flags: ["nodejs_compat"], workers_dev: false,
        assets: { directory: "site", binding: "ASSETS", html_handling: "drop-trailing-slash", not_found_handling: "404-page", run_worker_first: ["/api/*", "/product/*", "/admin", "/admin/*"] },
      }),
      "site/index.html": "<p>admin</p>",
    });
    const inventory = await collectPackageInventory(forged);
    writeFileSync(path.join(forged, "package-manifest.json"), JSON.stringify({
      kind: "admin-preview", ready: true, previewReady: true, productionReady: true, inventory: inventory.inventory,
    }));
    expect(() => readAdminPreviewRuntime(forged)).toThrow("invalid_admin_preview");
  });

  it("returns exit 0 for a match and exit 1 for a change without writing", async () => {
    const root = tempDir();
    writePackage(root);
    await seal(root);
    const before = statSync(path.join(root, "package-manifest.json")).mtimeMs;
    const ok = spawnSync(process.execPath, [CLI, "--package", root], { encoding: "utf8", windowsHide: true });
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout)).toEqual({ ok: true });
    expect(statSync(path.join(root, "package-manifest.json")).mtimeMs).toBe(before);
    writeFileSync(path.join(root, "worker.js"), "tampered-bytes");
    const bad = spawnSync(process.execPath, [CLI, "--package", root], { encoding: "utf8", windowsHide: true });
    expect(bad.status).toBe(1);
    expect(JSON.parse(bad.stdout)).toMatchObject({ ok: false, code: "package_integrity_failed", rule: "changed_file" });
    expect(bad.stdout).not.toContain("tampered-bytes");
    const deploy = spawnSync(process.execPath, [CLI, "--package", root, "--deploy"], { encoding: "utf8", windowsHide: true });
    expect(deploy.status).toBe(1);
    expect(JSON.parse(deploy.stdout)).toEqual({ ok: false, code: "invalid_arguments" });
  });

  it("does not read an oversized manifest", async () => {
    const root = tempDir();
    writePackage(root);
    await seal(root);
    const mod = await import("../scripts/cloudflare/package-integrity.mjs");
    const limit = mod.METADATA_READ_LIMIT_BYTES;
    const reads: string[] = [];
    const realLstat = fs.lstatSync;
    const realRead = fs.readFileSync;
    mod.useIntegrityIoForTests({
      lstatSync(target: PathLike) {
        const stat = realLstat(target);
        if (String(target).endsWith(`${path.sep}package-manifest.json`)) return oversizedStat(stat, limit);
        return stat;
      },
      readFileSync(target: PathLike) {
        reads.push(String(target));
        return realRead(target);
      },
    });
    try {
      const result = await verifyPackageIntegrity(root);
      expect(result).toMatchObject({ ok: false, code: "package_integrity_failed", rule: "byte_limit" });
      expect(reads.some((item) => item.endsWith(`${path.sep}package-manifest.json`))).toBe(false);
    } finally {
      mod.useIntegrityIoForTests(null);
    }
  });

  it("hides a sensitive read failure behind a fixed rule", async () => {
    const root = tempDir();
    writePackage(root);
    const mod = await import("../scripts/cloudflare/package-integrity.mjs");
    const realRead = fs.readFileSync;
    mod.useIntegrityIoForTests({
      readFileSync(target: PathLike) {
        if (String(target).endsWith(`${path.sep}worker.js`)) throw new Error("sensitive-secret-value");
        return realRead(target);
      },
    });
    try {
      const result = await collectPackageInventory(root);
      expect(result).toEqual({ ok: false, code: "package_integrity_failed", rule: "read_failed" });
      expect(JSON.stringify(result)).not.toContain("sensitive-secret-value");
    } finally {
      mod.useIntegrityIoForTests(null);
    }
  });

  it("stops a deep or very wide directory tree before it can grow without a bound", async () => {
    const root = tempDir();
    const mod = await import("../scripts/cloudflare/package-integrity.mjs");
    const maxDepth = mod.PACKAGE_INTEGRITY_LIMITS.maxDepth;
    const maxDirectories = mod.PACKAGE_INTEGRITY_LIMITS.maxDirectories;
    const realLstat = fs.lstatSync;
    const realReadDir = fs.readdirSync;
    let reads = 0;
    mod.useIntegrityIoForTests({
      lstatSync(target: PathLike) {
        if (String(target).startsWith(root)) return { isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false, size: 0 };
        return realLstat(target);
      },
      readdirSync(target: PathLike) {
        if (!String(target).startsWith(root)) return realReadDir(target);
        reads += 1;
        if (reads > maxDepth + 5) throw new Error("unbounded-walk");
        return ["child"];
      },
    });
    try {
      const deep = await verifyPackageIntegrity(root);
      expect(deep).toMatchObject({ ok: false, code: "package_integrity_failed", rule: "depth_limit" });
      expect(JSON.stringify(deep)).not.toContain("unbounded-walk");
      expect(reads).toBeLessThanOrEqual(maxDepth + 1);
    } finally {
      mod.useIntegrityIoForTests(null);
    }

    let listed = 0;
    mod.useIntegrityIoForTests({
      lstatSync(target: PathLike) {
        if (String(target).startsWith(root)) return { isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false, size: 0 };
        return realLstat(target);
      },
      readdirSync(target: PathLike) {
        if (!String(target).startsWith(root)) return realReadDir(target);
        listed += 1;
        if (path.resolve(String(target)) === root) return Array.from({ length: maxDirectories + 1 }, (_item, index) => `d${index}`);
        return [];
      },
    });
    try {
      const wide = await verifyPackageIntegrity(root);
      expect(wide).toMatchObject({ ok: false, code: "package_integrity_failed", rule: "directory_limit" });
      expect(listed).toBeLessThanOrEqual(maxDirectories);
    } finally {
      mod.useIntegrityIoForTests(null);
    }
  });

  it("rejects an oversized inventory list before walking its entries", async () => {
    const mod = await import("../scripts/cloudflare/package-integrity.mjs");
    const maxFiles = mod.PACKAGE_INTEGRITY_LIMITS.maxFiles;
    let walked = false;
    const files = new Proxy([], {
      get(_target, prop) {
        if (prop === "length") return maxFiles + 1;
        walked = true;
        return undefined;
      },
    });
    const result = mod.gateInventoryList(files);
    expect(result).toMatchObject({ ok: false, code: "package_integrity_failed", rule: "file_limit" });
    expect(walked).toBe(false);
  });

  it("returns a safe CLI failure when verification throws", async () => {
    const saved = process.exitCode;
    const mod = await import("../scripts/cloudflare/verify-package-integrity.mjs");
    process.exitCode = saved;
    expect(typeof mod.runIntegrityCli).toBe("function");
    let stdout = "";
    let stderr = "";
    const code = mod.runIntegrityCli(["--package", "unused"], {
      write: (line: string) => { stdout += line; },
      writeError: (line: string) => { stderr += line; },
      verify: () => { throw new Error("sensitive-secret-value"); },
    });
    expect(code).toBe(1);
    expect(JSON.parse(stdout)).toEqual({ ok: false, code: "package_integrity_failed", rule: "read_failed" });
    expect(stdout).not.toContain("sensitive-secret-value");
    expect(stderr).not.toContain("sensitive-secret-value");
  });
});
