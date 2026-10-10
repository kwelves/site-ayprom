import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { preparePinnedCatalogBuild } from "@/cloudflare/static-build/producer/pinned-build-preparation";

const releaseId = "20000000-0000-4000-8000-000000000001";
const capability = "local-pinned-build-capability-fixture-2026";
const receipt = { releaseId, revision: 9, sha256: "a".repeat(64), documentCount: 1 };
const publication = { format: 1 as const, ...receipt, documents: { category: [{ slug: "pto" }],
  subcategory: [], brand: [], category_brand: [], vehicle_type: [], vehicle_hotspot: [], product: [] } };
const file = { path: "C:\\repo\\dist\\staging\\run\\meta\\catalog-publication-export.json",
  sha256: "b".repeat(64), releaseId };

describe("local pinned build preparation", () => {
  it("runs capture, export and file handoff in order without returning the capability", async () => {
    const calls: string[] = [];
    const capture = vi.fn(async () => { calls.push("capture"); return receipt; });
    const exportRelease = vi.fn(async () => { calls.push("export"); return publication; });
    const write = vi.fn(async () => { calls.push("write"); return file; });
    const result = await preparePinnedCatalogBuild({ expectedRevision: 9, identity: { releaseId, capability },
      capture, exportRelease, write });
    expect(calls).toEqual(["capture", "export", "write"]);
    expect(capture).toHaveBeenCalledWith({ expectedRevision: 9, releaseId,
      capabilityHash: createHash("sha256").update(capability).digest("hex") });
    expect(exportRelease).toHaveBeenCalledWith(receipt, capability);
    expect(write).toHaveBeenCalledWith(publication);
    expect(result).toEqual({ revision: 9, releaseId, publicationSha256: receipt.sha256,
      file: { path: file.path, sha256: file.sha256, releaseId } });
    expect(JSON.stringify(result)).not.toContain(capability);
  });

  it.each(["capture", "export", "write"])("fails closed if %s fails, without later stages or retry", async (stage) => {
    const capture = vi.fn().mockImplementation(async () => { if (stage === "capture") throw new Error(capability); return receipt; });
    const exportRelease = vi.fn().mockImplementation(async () => { if (stage === "export") throw new Error(capability); return publication; });
    const write = vi.fn().mockImplementation(async () => { if (stage === "write") throw new Error(capability); return file; });
    const failure = await preparePinnedCatalogBuild({ expectedRevision: 9,
      identity: { releaseId, capability }, capture, exportRelease, write }).catch((error: unknown) => error);
    expect(String(failure)).toBe("PinnedBuildPreparationError: Pinned build unavailable");
    expect(capture).toHaveBeenCalledTimes(1);
    expect(exportRelease).toHaveBeenCalledTimes(stage === "capture" ? 0 : 1);
    expect(write).toHaveBeenCalledTimes(stage === "write" ? 1 : stage === "capture" ? 0 : 0);
  });

  it("rejects a mismatched receipt before export or write", async () => {
    const exportRelease = vi.fn(); const write = vi.fn();
    await expect(preparePinnedCatalogBuild({ expectedRevision: 9,
      identity: { releaseId, capability }, capture: async () => ({ ...receipt, revision: 10 }),
      exportRelease, write })).rejects.toThrow("Pinned build unavailable");
    expect(exportRelease).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
