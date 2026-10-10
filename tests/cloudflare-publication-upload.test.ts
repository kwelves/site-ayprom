import { describe, expect, it, vi } from "vitest";
import { stageInactiveCandidate, type CloudflareVersionPort } from "@/cloudflare/publication/cloudflare-version-port";

const candidate = {
  packageDir: "C:/work/dist/worker-packages/candidate-1",
  releaseId: "20000000-0000-4000-8000-000000000001",
  revision: 7,
  releaseSha256: "a".repeat(64),
  packageSha256: "b".repeat(64),
};

function fixture() {
  const events: string[] = [];
  const currentDeployment = vi.fn(async () => {
    events.push("current");
    return { deploymentId: "deployment-old", versionId: "version-old" };
  });
  const port: CloudflareVersionPort = {
    currentDeployment,
    uploadInactive: vi.fn(async () => { events.push("upload"); return { versionId: "version-new" }; }),
    preview: vi.fn(async () => { events.push("preview"); return { url: "https://preview.example.test" }; }),
    activate: vi.fn(async () => { events.push("activate"); return { deploymentId: "deployment-new" }; }),
    rollback: vi.fn(async () => { events.push("rollback"); return { deploymentId: "deployment-rollback" }; }),
  };
  const inspectPackage = vi.fn(async () => ({ ok: true as const, ready: true as const,
    productionReady: false as boolean, releaseId: candidate.releaseId, revision: candidate.revision,
    releaseSha256: candidate.releaseSha256, packageSha256: candidate.packageSha256 }));
  const probe = vi.fn(async () => { events.push("probe"); return true; });
  const journal = vi.fn(async () => { events.push("journal"); });
  return { events, currentDeployment, port, inspectPackage, probe, journal };
}

describe("inactive Cloudflare candidate", () => {
  it("verifies the preview but never activates or claims production readiness", async () => {
    const f = fixture();
    const result = await stageInactiveCandidate({ candidate, cloudflare: f.port,
      inspectPackage: f.inspectPackage, probe: f.probe, journal: f.journal });
    expect(result).toEqual({ ok: true, status: "inactive_verified", versionId: "version-new",
      productionReady: false });
    expect(f.events).toEqual(["current", "journal", "upload", "journal", "preview", "probe", "current", "journal"]);
    expect(f.port.activate).not.toHaveBeenCalled();
    expect(f.port.rollback).not.toHaveBeenCalled();
    expect(f.probe).toHaveBeenCalledWith({ url: "https://preview.example.test", versionId: "version-new",
      releaseId: candidate.releaseId });
    expect(f.journal).toHaveBeenNthCalledWith(1, { status: "upload_started", versionId: null,
      deploymentId: "deployment-old", previousVersionId: "version-old",
      releaseId: candidate.releaseId, revision: 7, releaseSha256: candidate.releaseSha256,
      packageSha256: candidate.packageSha256 });
    expect(f.journal).toHaveBeenLastCalledWith({ status: "inactive_verified", versionId: "version-new",
      deploymentId: "deployment-old", previousVersionId: "version-old",
      releaseId: candidate.releaseId, revision: 7, releaseSha256: candidate.releaseSha256,
      packageSha256: candidate.packageSha256 });
  });

  it("rejects wrong release or package hashes before any remote call", async () => {
    for (const changed of ["releaseId", "releaseSha256", "packageSha256", "productionReady"] as const) {
      const f = fixture();
      f.inspectPackage.mockResolvedValueOnce({ ok: true, ready: true, productionReady: changed === "productionReady",
        releaseId: changed === "releaseId" ? "other" : candidate.releaseId, revision: 7,
        releaseSha256: changed === "releaseSha256" ? "c".repeat(64) : candidate.releaseSha256,
        packageSha256: changed === "packageSha256" ? "d".repeat(64) : candidate.packageSha256 });
      const result = await stageInactiveCandidate({ candidate, cloudflare: f.port,
        inspectPackage: f.inspectPackage, probe: f.probe, journal: f.journal });
      expect(result).toMatchObject({ ok: false, status: "rejected", productionReady: false });
      expect(f.currentDeployment).not.toHaveBeenCalled();
      expect(f.port.uploadInactive).not.toHaveBeenCalled();
    }
  });

  it("does not treat an upload with a lost response as safely retryable", async () => {
    const f = fixture();
    vi.mocked(f.port.uploadInactive).mockRejectedValueOnce(new Error("private-token"));
    const result = await stageInactiveCandidate({ candidate, cloudflare: f.port,
      inspectPackage: f.inspectPackage, probe: f.probe, journal: f.journal });
    expect(result).toMatchObject({ ok: false, status: "unresolved", productionReady: false });
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(f.port.activate).not.toHaveBeenCalled();
    expect(f.journal).toHaveBeenLastCalledWith(expect.objectContaining({ status: "unresolved",
      reasonCode: "upload_response_unknown", versionId: null }));
    expect(f.port.uploadInactive).toHaveBeenCalledTimes(1);
  });

  it("keeps the old deployment when a known inactive preview fails", async () => {
    for (const failure of ["preview", "probe"] as const) {
      const f = fixture();
      if (failure === "preview") vi.mocked(f.port.preview).mockRejectedValueOnce(new Error("private-token"));
      else f.probe.mockResolvedValueOnce(false);
      const result = await stageInactiveCandidate({ candidate, cloudflare: f.port,
        inspectPackage: f.inspectPackage, probe: f.probe, journal: f.journal });
      expect(result).toMatchObject({ ok: false, status: "failed_old_live", productionReady: false });
      expect(JSON.stringify(result)).not.toContain("private-token");
      expect(f.port.activate).not.toHaveBeenCalled();
      expect(f.port.rollback).not.toHaveBeenCalled();
      expect(f.journal).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed_old_live",
        reasonCode: "preview_failed", versionId: "version-new" }));
    }
  });

  it("reports unresolved when the old deployment cannot be reconfirmed", async () => {
    const f = fixture();
    f.probe.mockResolvedValueOnce(false);
    f.currentDeployment.mockResolvedValueOnce({ deploymentId: "deployment-old", versionId: "version-old" })
      .mockRejectedValueOnce(new Error("unknown deployment"));
    const result = await stageInactiveCandidate({ candidate, cloudflare: f.port,
      inspectPackage: f.inspectPackage, probe: f.probe, journal: f.journal });
    expect(result).toMatchObject({ ok: false, status: "unresolved", productionReady: false });
    expect(f.port.activate).not.toHaveBeenCalled();
  });

  it("does not accept a duplicate version ID or a deployment changed by another operator", async () => {
    for (const scenario of ["duplicate", "concurrent"] as const) {
      const f = fixture();
      if (scenario === "duplicate") vi.mocked(f.port.uploadInactive).mockResolvedValueOnce({ versionId: "version-old" });
      else f.currentDeployment.mockResolvedValueOnce({ deploymentId: "deployment-old", versionId: "version-old" })
        .mockResolvedValueOnce({ deploymentId: "deployment-other", versionId: "version-other" });
      const result = await stageInactiveCandidate({ candidate, cloudflare: f.port,
        inspectPackage: f.inspectPackage, probe: f.probe, journal: f.journal });
      expect(result).toMatchObject({ ok: false, status: "unresolved", productionReady: false });
      expect(f.journal).toHaveBeenLastCalledWith(expect.objectContaining({ status: "unresolved" }));
      expect(f.port.activate).not.toHaveBeenCalled();
      expect(f.port.rollback).not.toHaveBeenCalled();
    }
  });

  it("does not report a recorded candidate when journal persistence fails", async () => {
    const f = fixture();
    f.journal.mockRejectedValueOnce(new Error("private-storage-path"));
    const result = await stageInactiveCandidate({ candidate, cloudflare: f.port,
      inspectPackage: f.inspectPackage, probe: f.probe, journal: f.journal });
    expect(result).toEqual({ ok: false, status: "rejected", productionReady: false });
    expect(f.port.uploadInactive).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private-storage-path");
  });

  it("does not probe or claim success when the uploaded version cannot be recorded", async () => {
    const f = fixture();
    f.journal.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("private-token"));
    const result = await stageInactiveCandidate({ candidate, cloudflare: f.port,
      inspectPackage: f.inspectPackage, probe: f.probe, journal: f.journal });
    expect(result).toEqual({ ok: false, status: "unresolved", productionReady: false });
    expect(f.probe).not.toHaveBeenCalled();
    expect(f.port.preview).not.toHaveBeenCalled();
    expect(f.port.uploadInactive).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("private-token");
  });

  it("does not claim verified state when the final journal write fails", async () => {
    const f = fixture();
    f.journal.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("private-token"));
    const result = await stageInactiveCandidate({ candidate, cloudflare: f.port,
      inspectPackage: f.inspectPackage, probe: f.probe, journal: f.journal });
    expect(result).toEqual({ ok: false, status: "unresolved", productionReady: false });
    expect(f.port.activate).not.toHaveBeenCalled();
  });

  it("rejects malformed preview URLs and embedded credentials before probing", async () => {
    for (const url of ["https://", "https://user:private-token@preview.example.test/",
      "https://preview.example.test/?token=private-token", "http://preview.example.test/"]) {
      const f = fixture();
      vi.mocked(f.port.preview).mockResolvedValueOnce({ url });
      const result = await stageInactiveCandidate({ candidate, cloudflare: f.port,
        inspectPackage: f.inspectPackage, probe: f.probe, journal: f.journal });
      expect(result).toMatchObject({ ok: false, status: "failed_old_live", productionReady: false });
      expect(f.probe).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("private-token");
    }
  });
});
