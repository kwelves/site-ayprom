import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectPackageInventory } from "../scripts/cloudflare/package-integrity.mjs";
import { inspectPublicationPackage } from "../scripts/cloudflare/publication-package-inspector.mjs";
import { stagePublicationPackage } from "@/cloudflare/publication/stage-publication-package";
import { stageInactiveCandidate } from "@/cloudflare/publication/cloudflare-version-port";
import { createLocalCloudflareVersionPort } from "@/cloudflare/publication/local-cloudflare-version-port";
import { createReleaseJournal } from "@/cloudflare/publication/release-journal";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "ayprom-package-stage-"));
  roots.push(root);
  const packageDir = path.join(root, "package");
  mkdirSync(path.join(packageDir, "site"), { recursive: true });
  writeFileSync(path.join(packageDir, "site/index.html"), "<h1>fixture</h1>");
  writeFileSync(path.join(packageDir, "worker.js"), "export default {};");
  writeFileSync(path.join(packageDir, "source-revision.json"), JSON.stringify({ schemaVersion: 1, revision: 7 }));
  writeFileSync(path.join(packageDir, "wrangler.jsonc"), JSON.stringify({
    name: "ayprom-static-worker-package", main: "worker.js", compatibility_date: "2026-09-19",
    compatibility_flags: ["nodejs_compat"], workers_dev: false,
    assets: { directory: "site", html_handling: "drop-trailing-slash", not_found_handling: "404-page",
      run_worker_first: ["/api/*", "/product/*"] },
  }));
  const inventory = collectPackageInventory(packageDir);
  writeFileSync(path.join(packageDir, "package-manifest.json"), JSON.stringify({
    schemaVersion: 1, ready: true, productionReady: false, sourceRevision: 7,
    release: { id: "20000000-0000-4000-8000-000000000001", revision: 7, sha256: "a".repeat(64) },
    requiredBindings: ["ASSETS", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "PUBLICATION_ID", "PUBLICATION_CAPABILITY"],
    worker: { rawBytes: Buffer.byteLength("export default {};"), gzipBytes: 10 },
    assets: { fileCount: 1, totalBytes: Buffer.byteLength("<h1>fixture</h1>") }, inventory: inventory.inventory,
  }));
  const inspected = await inspectPublicationPackage(packageDir);
  if (!inspected.ok) throw new Error("fixture_rejected");
  const candidate = { packageDir, releaseId: inspected.releaseId, revision: inspected.revision,
    releaseSha256: inspected.releaseSha256, packageSha256: inspected.packageSha256 };
  const cloudflare = createLocalCloudflareVersionPort({ initialVersionId: "old" });
  const upload = vi.spyOn(cloudflare, "uploadInactive");
  const activate = vi.spyOn(cloudflare, "activate");
  const rollback = vi.spyOn(cloudflare, "rollback");
  const current = vi.spyOn(cloudflare, "currentDeployment");
  const probe = vi.fn(async () => true);
  const journalPath = path.join(root, "release.jsonl");
  return { root, packageDir, candidate, cloudflare, upload, activate, rollback, current, probe, journalPath };
}

describe("real package and journal staging boundary", () => {
  it("accepts the real inspector failure union without invented success metadata", async () => {
    const f = await fixture();
    const result = await stageInactiveCandidate({ ...f, inspectPackage: inspectPublicationPackage,
      candidate: { ...f.candidate, packageDir: path.join(f.root, "missing") },
      journal: vi.fn(async () => {}) });
    expect(result).toEqual({ ok: false, status: "rejected", productionReady: false });
    expect(f.current).not.toHaveBeenCalled();
  });

  it("inspects actual files and persists identity before preview without changing active deployment", async () => {
    const f = await fixture();
    const before = await f.cloudflare.currentDeployment();
    f.probe.mockImplementationOnce(async () => {
      expect((await createReleaseJournal({ path: f.journalPath }).read()).map((e) => e.status))
        .toEqual(["upload_started", "inactive_uploaded"]);
      return true;
    });
    expect(await stagePublicationPackage(f)).toMatchObject({ ok: true, status: "inactive_verified", productionReady: false });
    const history = await createReleaseJournal({ path: f.journalPath }).read();
    expect(history.map((e) => e.status)).toEqual(["upload_started", "inactive_uploaded", "inactive_verified"]);
    expect(history.every((e) => e.packageSha256 === f.candidate.packageSha256)).toBe(true);
    expect(await f.cloudflare.currentDeployment()).toEqual(before);
    expect(f.activate).not.toHaveBeenCalled();
    expect(f.rollback).not.toHaveBeenCalled();
  });

  it.each(["bytes", "digest", "release", "revision"])("rejects mismatched %s before port calls", async (kind) => {
    const f = await fixture();
    if (kind === "bytes") writeFileSync(path.join(f.packageDir, "worker.js"), "private-token");
    if (kind === "digest") f.candidate.packageSha256 = "c".repeat(64);
    if (kind === "release") f.candidate.releaseSha256 = "c".repeat(64);
    if (kind === "revision") f.candidate.revision = 8;
    const result = await stagePublicationPackage(f);
    expect(result).toMatchObject({ ok: false, status: "rejected", productionReady: false });
    expect(f.current).not.toHaveBeenCalled();
    expect(f.upload).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private-token");
  });

  it("blocks replay after reopening the actual journal", async () => {
    const f = await fixture();
    f.upload.mockRejectedValueOnce(new Error("private-token"));
    expect(await stagePublicationPackage(f)).toMatchObject({ ok: false, status: "unresolved" });
    const history = readFileSync(f.journalPath, "utf8");
    expect(await stagePublicationPackage(f)).toMatchObject({ ok: false, status: "unresolved" });
    expect(f.upload).toHaveBeenCalledTimes(1);
    expect(readFileSync(f.journalPath, "utf8")).toBe(history);
  });

  it("contains journal errors and preserves foreign locks", async () => {
    const f = await fixture();
    writeFileSync(f.journalPath + ".operation.lock", "foreign-owner");
    const result = await stagePublicationPackage(f);
    expect(result).toMatchObject({ ok: false, status: "unresolved" });
    expect(readFileSync(f.journalPath + ".operation.lock", "utf8")).toBe("foreign-owner");
    expect(f.current).not.toHaveBeenCalled();
    expect(f.upload).not.toHaveBeenCalled();
  });

  it("runs Node CLI as an explicit local contract and rejects remote flags or replay", async () => {
    const f = await fixture();
    const cli = path.resolve("scripts/cloudflare/stage-publication-package.mjs");
    const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args],
      { encoding: "utf8", timeout: 15_000, windowsHide: true });
    const args = ["--local-contract", "--package", f.packageDir, "--journal", f.journalPath];
    const first = run(...args);
    expect(first.status, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ ok: true, status: "inactive_verified",
      fixtureOnly: true, remoteVerified: false, productionReady: false });
    expect(first.stdout + first.stderr).not.toContain(f.root);
    expect(first.stdout).not.toContain("preview");
    const before = readFileSync(f.journalPath, "utf8");
    const replay = run(...args);
    expect(replay.status, replay.stderr).toBe(1);
    expect(JSON.parse(replay.stdout)).toMatchObject({ ok: false, status: "rejected" });
    expect(readFileSync(f.journalPath, "utf8")).toBe(before);
    const rejected = run(...args, "--deploy", "private-token");
    expect(rejected.status).toBe(2);
    expect(rejected.stdout + rejected.stderr).not.toContain("private-token");
    expect(rejected.stdout + rejected.stderr).not.toContain(f.root);
    expect(existsSync(f.journalPath + ".operation.lock")).toBe(false);
  });
});
