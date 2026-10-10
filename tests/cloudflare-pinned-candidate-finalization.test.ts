import { describe, expect, it, vi } from "vitest";
import { verifyPinnedCandidateFinalState } from "@/cloudflare/static-build/producer/pinned-candidate-finalization";

describe("pinned candidate final state", () => {
  it("accepts only the unchanged revision, sealed source and package after runtime smoke", async () => {
    const events: string[] = [];
    const result = await verifyPinnedCandidateFinalState({
      expectedRevision: 4,
      readRevision: async () => { events.push("revision"); return 4; },
      verifySealedSource: async () => { events.push("source"); return true; },
      verifyPackage: () => { events.push("package"); return true; },
    });
    expect(result).toEqual({ ok: true });
    expect(events).toEqual(["revision", "source", "package"]);
  });

  it.each([
    { revision: 5, source: true, packageOk: true, code: "publication_revision_changed" },
    { revision: 4, source: false, packageOk: true, code: "sealed_source_changed" },
    { revision: 4, source: true, packageOk: false, code: "package_integrity_failed" },
  ])("rejects a late change: $code", async ({ revision, source, packageOk, code }) => {
    const result = await verifyPinnedCandidateFinalState({
      expectedRevision: 4,
      readRevision: async () => revision,
      verifySealedSource: async () => source,
      verifyPackage: () => packageOk,
    });
    expect(result).toEqual({ ok: false, code });
  });

  it("fails closed if any final check throws", async () => {
    for (const failed of ["revision", "source", "package"]) {
      const result = await verifyPinnedCandidateFinalState({
        expectedRevision: 4,
        readRevision: failed === "revision" ? async () => { throw new Error("private detail"); } : async () => 4,
        verifySealedSource: failed === "source" ? async () => { throw new Error("private detail"); } : async () => true,
        verifyPackage: failed === "package" ? vi.fn(() => { throw new Error("private detail"); }) : () => true,
      });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("private detail");
    }
  });
});
