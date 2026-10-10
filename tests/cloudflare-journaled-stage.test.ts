import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReleaseJournal } from "@/cloudflare/publication/release-journal";
import { createLocalCloudflareVersionPort } from "@/cloudflare/publication/local-cloudflare-version-port";
import { stageJournaledCandidate } from "@/cloudflare/publication/stage-journaled-candidate";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const candidate = { packageDir: "local-fixture", releaseId: "20000000-0000-4000-8000-000000000001",
  revision: 7, releaseSha256: "a".repeat(64), packageSha256: "b".repeat(64) };
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "ayprom-journaled-stage-"));
  roots.push(root);
  const file = path.join(root, "release.jsonl");
  const journal = createReleaseJournal({ path: file });
  const cloudflare = createLocalCloudflareVersionPort({ initialVersionId: "old" });
  const upload = vi.spyOn(cloudflare, "uploadInactive");
  const current = vi.spyOn(cloudflare, "currentDeployment");
  const inspectPackage = vi.fn(async () => ({ ...candidate, ok: true, ready: true, productionReady: false }));
  const probe = vi.fn(async () => true);
  return { file, journal, cloudflare, upload, current, inspectPackage, probe };
}

describe("journaled inactive staging", () => {
  it("persists three stages using the real file journal, and never activates", async () => {
    const f = fixture();
    const before = await f.cloudflare.currentDeployment();
    const result = await stageJournaledCandidate({ ...f, candidate });
    expect(result).toMatchObject({ ok: true, status: "inactive_verified", productionReady: false });
    expect((await f.journal.read()).map((record) => record.status)).toEqual(["upload_started", "inactive_uploaded", "inactive_verified"]);
    expect(await f.cloudflare.currentDeployment()).toEqual(before);
    expect(existsSync(`${f.file}.operation.lock`)).toBe(false);
  });

  it("does not blindly upload again after a lost response and reopened journal", async () => {
    const f = fixture();
    f.upload.mockRejectedValueOnce(new Error("private-token"));
    expect(await stageJournaledCandidate({ ...f, candidate })).toMatchObject({ ok: false, status: "unresolved" });
    const reopened = createReleaseJournal({ path: f.file });
    const result = await stageJournaledCandidate({ ...f, journal: reopened, candidate });
    expect(result).toMatchObject({ ok: false, status: "unresolved" });
    expect(f.upload).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("private-token");
  });

  it("does not upload a verified candidate again or reuse a different package for its release", async () => {
    const f = fixture();
    await stageJournaledCandidate({ ...f, candidate });
    const original = readFileSync(f.file, "utf8");
    for (const next of [candidate, { ...candidate, packageSha256: "c".repeat(64) }]) {
      expect(await stageJournaledCandidate({ ...f, candidate: next })).toMatchObject({ ok: false, status: "rejected" });
    }
    expect(f.upload).toHaveBeenCalledTimes(1);
    expect(readFileSync(f.file, "utf8")).toBe(original);
  });

  it("serializes concurrent operations through the whole async preview, not just each append", async () => {
    const f = fixture();
    let unblock!: () => void;
    let ready!: () => void;
    const entered = new Promise<void>((resolve) => { ready = resolve; });
    const held = new Promise<void>((resolve) => { unblock = resolve; });
    f.probe.mockImplementationOnce(async () => { ready(); await held; return true; });
    const first = stageJournaledCandidate({ ...f, candidate });
    try {
      await entered;
      expect(await stageJournaledCandidate({ ...f, candidate })).toMatchObject({ ok: false, status: "unresolved" });
      expect(f.upload).toHaveBeenCalledTimes(1);
    } finally { unblock(); }
    expect(await first).toMatchObject({ ok: true });
  });

  it("preserves foreign operation locks and corrupt history without any port call", async () => {
    const f = fixture();
    writeFileSync(`${f.file}.operation.lock`, "foreign-owner");
    expect(await stageJournaledCandidate({ ...f, candidate })).toMatchObject({ ok: false, status: "unresolved" });
    expect(readFileSync(`${f.file}.operation.lock`, "utf8")).toBe("foreign-owner");
    rmSync(`${f.file}.operation.lock`);
    writeFileSync(f.file, "private-token-not-json\n");
    const result = await stageJournaledCandidate({ ...f, candidate });
    expect(result).toMatchObject({ ok: false, status: "unresolved" });
    expect(f.current).not.toHaveBeenCalled();
    expect(f.upload).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private-token");
  });
});
