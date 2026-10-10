import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectPackageInventory } from "../scripts/cloudflare/package-integrity.mjs";
import { resolvePublicPackage } from "../scripts/cloudflare/resolve-public-package.mjs";

const created: string[] = [];
afterEach(() => { for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(sourceRevision = 7) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "ayprom-public-package-selection-"));
  created.push(repoRoot);
  const packageName = "local-public";
  const packageDir = path.join(repoRoot, "dist", "worker-packages", packageName);
  mkdirSync(path.join(packageDir, "site"), { recursive: true });
  writeFileSync(path.join(packageDir, "site", "index.html"), "<h1>AYPROM</h1>");
  writeFileSync(path.join(packageDir, "worker.js"), "export default { fetch: () => new Response('ok') };");
  writeFileSync(path.join(packageDir, "wrangler.jsonc"), JSON.stringify({
    main: "worker.js", workers_dev: false, assets: { directory: "site", run_worker_first: ["/api/*", "/product/*"] },
  }));
  writeFileSync(path.join(packageDir, "source-revision.json"), JSON.stringify({ schemaVersion: 1, revision: sourceRevision }));
  const inventory = collectPackageInventory(packageDir);
  if (!inventory.ok) throw new Error("fixture_inventory_failed");
  writeFileSync(path.join(packageDir, "package-manifest.json"), JSON.stringify({
    schemaVersion: 1, ready: true, productionReady: false, sourceRevision, inventory: inventory.inventory,
  }));
  return { repoRoot, packageName, packageDir };
}

describe("local public package resolver", () => {
  it("returns only an intact public package at the current catalog revision", async () => {
    const source = fixture();
    const result = await resolvePublicPackage({ repoRoot: source.repoRoot, packageName: source.packageName, readCurrentRevision: async () => 7 });
    expect(result).toEqual({ ok: true, packageDir: source.packageDir, sourceRevision: 7, productionReady: false });
  });

  it("refuses a package that became stale after packaging", async () => {
    const source = fixture();
    const result = await resolvePublicPackage({ repoRoot: source.repoRoot, packageName: source.packageName, readCurrentRevision: async () => 8 });
    expect(result).toEqual({ ok: false, code: "publication_revision_changed" });
  });

  it("refuses a changed file even when the catalog revision is stable", async () => {
    const source = fixture();
    writeFileSync(path.join(source.packageDir, "worker.js"), "tampered");
    const result = await resolvePublicPackage({ repoRoot: source.repoRoot, packageName: source.packageName, readCurrentRevision: async () => 7 });
    expect(result).toMatchObject({ ok: false, code: "package_integrity_failed" });
  });

  it("rejects a manifest-only version edit instead of selecting an old site as fresh", async () => {
    const source = fixture();
    const file = path.join(source.packageDir, "package-manifest.json");
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    manifest.sourceRevision = 8;
    writeFileSync(file, JSON.stringify(manifest));
    const result = await resolvePublicPackage({ repoRoot: source.repoRoot, packageName: source.packageName, readCurrentRevision: async () => 8 });
    expect(result).toEqual({ ok: false, code: "package_integrity_failed" });
  });

  it("refuses missing version evidence or an unavailable public RPC without leaking errors", async () => {
    const source = fixture();
    const file = path.join(source.packageDir, "package-manifest.json");
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    delete manifest.sourceRevision;
    writeFileSync(file, JSON.stringify(manifest));
    expect(await resolvePublicPackage({ repoRoot: source.repoRoot, packageName: source.packageName, readCurrentRevision: async () => 7 }))
      .toEqual({ ok: false, code: "publication_revision_unavailable" });
    manifest.sourceRevision = 7;
    writeFileSync(file, JSON.stringify(manifest));
    const result = await resolvePublicPackage({
      repoRoot: source.repoRoot, packageName: source.packageName,
      readCurrentRevision: async () => { throw new Error("private-key-in-error"); },
    });
    expect(result).toEqual({ ok: false, code: "publication_revision_unavailable" });
    expect(JSON.stringify(result)).not.toContain("private-key-in-error");
  });
});

it("rejects a remote revision source before resolving any local public package", () => {
  const key = "sb_publishable_remote_not_allowed";
  const script = path.resolve(import.meta.dirname, "../scripts/cloudflare/resolve-public-package-cli.mjs");
  const result = spawnSync(process.execPath, [script, "--package", "local-public"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key },
    encoding: "utf8", timeout: 15_000, windowsHide: true,
  });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout.trim())).toEqual({ ok: false, code: "local_probe_invalid_binding" });
  expect(result.stdout + result.stderr).not.toContain(key);
});
