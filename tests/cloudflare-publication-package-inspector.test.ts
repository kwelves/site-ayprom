import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectPackageInventory } from "../scripts/cloudflare/package-integrity.mjs";
import { inspectPublicationPackage } from "../scripts/cloudflare/publication-package-inspector.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const release = { id: "20000000-0000-4000-8000-000000000001", revision: 7, sha256: "a".repeat(64) };

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "ayprom-publication-inspector-"));
  roots.push(root);
  mkdirSync(path.join(root, "site"));
  writeFileSync(path.join(root, "site/index.html"), "<h1>fixture</h1>");
  const worker = "export default {};";
  writeFileSync(path.join(root, "worker.js"), worker);
  writeFileSync(path.join(root, "wrangler.jsonc"), JSON.stringify({ name: "ayprom-static-worker-package",
    main: "worker.js", compatibility_date: "2026-09-19", compatibility_flags: ["nodejs_compat"], workers_dev: false,
    assets: { directory: "site", html_handling: "drop-trailing-slash", not_found_handling: "404-page", run_worker_first: ["/api/*", "/product/*"] } }));
  writeFileSync(path.join(root, "source-revision.json"), JSON.stringify({ schemaVersion: 1, revision: 7 }));
  const inventory = collectPackageInventory(root);
  expect(inventory.ok).toBe(true);
  const manifest = { schemaVersion: 1, ready: true, productionReady: false, sourceRevision: 7, release,
    requiredBindings: ["ASSETS", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "PUBLICATION_ID", "PUBLICATION_CAPABILITY"],
    worker: { rawBytes: Buffer.byteLength(worker), gzipBytes: 10 },
    assets: { fileCount: 1, totalBytes: Buffer.byteLength("<h1>fixture</h1>") }, inventory: inventory.inventory };
  const file = path.join(root, "package-manifest.json");
  writeFileSync(file, JSON.stringify(manifest));
  return { root, file, manifest };
}

describe("publication package inspector", () => {
  it("inspects bytes and pinned metadata read-only with one stable package digest", async () => {
    const f = fixture();
    const before = readFileSync(f.file);
    const result = await inspectPublicationPackage(f.root);
    expect(result).toMatchObject({ ok: true, ready: true, productionReady: false,
      releaseId: release.id, revision: 7, releaseSha256: release.sha256 });
    if (!result.ok) throw new Error("fixture_inspection_failed");
    expect(result.packageSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await inspectPublicationPackage(f.root)).toEqual(result);
    expect(readFileSync(f.file)).toEqual(before);
  });

  it("covers the manifest itself, although inventory deliberately excludes it", async () => {
    const f = fixture();
    const first = await inspectPublicationPackage(f.root);
    writeFileSync(f.file, JSON.stringify({ ...f.manifest, release: { ...release, id: "20000000-0000-4000-8000-000000000002" } }));
    const second = await inspectPublicationPackage(f.root);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("fixture_inspection_failed");
    expect(second.packageSha256).not.toBe(first.packageSha256);
  });

  it.each(["preview", "production", "unready", "unpinned", "wrong-revision", "secret-field"])("rejects %s without echoing data", async (kind) => {
    const f = fixture();
    const manifest: Record<string, unknown> = { ...f.manifest };
    if (kind === "preview") { manifest.kind = "admin-preview"; manifest.ready = false; }
    if (kind === "production") manifest.productionReady = true;
    if (kind === "unready") manifest.ready = false;
    if (kind === "unpinned") delete manifest.release;
    if (kind === "wrong-revision") manifest.sourceRevision = 8;
    if (kind === "secret-field") manifest.PUBLICATION_CAPABILITY = "private-token";
    writeFileSync(f.file, JSON.stringify(manifest));
    const result = await inspectPublicationPackage(f.root);
    expect(result).toEqual({ ok: false, ready: false, productionReady: false, code: "publication_package_rejected" });
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(JSON.stringify(result)).not.toContain(f.root);
  });

  it("rejects changed, missing, or extra files through the existing integrity gate", async () => {
    for (const kind of ["changed", "missing", "extra"]) {
      const f = fixture();
      if (kind === "changed") writeFileSync(path.join(f.root, "worker.js"), "private-token");
      if (kind === "missing") rmSync(path.join(f.root, "worker.js"));
      if (kind === "extra") writeFileSync(path.join(f.root, "secret.env"), "private-token");
      expect(await inspectPublicationPackage(f.root)).toMatchObject({ ok: false, code: "publication_package_rejected" });
    }
  });

  it("rejects a resealed config outside the package and a false source revision", async () => {
    for (const kind of ["config", "revision"]) {
      const f = fixture();
      if (kind === "config") writeFileSync(path.join(f.root, "wrangler.jsonc"), JSON.stringify({ main: "../private-token.js", assets: { directory: "../site" } }));
      else writeFileSync(path.join(f.root, "source-revision.json"), JSON.stringify({ schemaVersion: 1, revision: 8 }));
      const inventory = collectPackageInventory(f.root);
      writeFileSync(f.file, JSON.stringify({ ...f.manifest, inventory: inventory.inventory }));
      expect(await inspectPublicationPackage(f.root)).toMatchObject({ ok: false, code: "publication_package_rejected" });
    }
  });

  it("CLI inspects only, rejects deployment flags, and reports no paths or secrets", () => {
    const f = fixture();
    const cli = path.resolve("scripts/cloudflare/inspect-publication-package.mjs");
    const accepted = spawnSync(process.execPath, [cli, "--package", f.root], { encoding: "utf8", timeout: 15_000, windowsHide: true });
    expect(accepted.status, accepted.stderr).toBe(0);
    expect(JSON.parse(accepted.stdout)).toMatchObject({ ok: true, productionReady: false });
    const rejected = spawnSync(process.execPath, [cli, "--package", f.root, "--deploy", "private-token"], { encoding: "utf8", timeout: 15_000, windowsHide: true });
    expect(rejected.status).toBe(2);
    expect(rejected.stdout + rejected.stderr).not.toContain("private-token");
    expect(rejected.stdout + rejected.stderr).not.toContain(f.root);
  });
});
