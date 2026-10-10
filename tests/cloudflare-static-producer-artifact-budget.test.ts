import { describe, expect, it } from "vitest";
import { STATIC_ASSET_MAX_COUNT, validateArtifactPolicy } from "@/cloudflare/static-build/artifact-policy";
import { combineArtifactCandidates } from "@/cloudflare/static-build/producer/run";
import type { PlannedStaticAsset } from "@/cloudflare/static-build/producer/static-assets";

// The producer must count crawl documents, .next/static and copied public files
// together. These lists stay in memory: the boundary is the policy input, not
// tens of thousands of files on disk.
const oneByte = new Uint8Array([1]);

function files(count: number, prefix: string): PlannedStaticAsset[] {
  return Array.from({ length: count }, (_, index) => ({
    outputFile: `${prefix}/${index}.js`,
    bytes: oneByte,
    sha256: "00",
  }));
}

describe("combined staging artifact budget", () => {
  it("accepts exactly 20 000 files spread across documents, next static and public", () => {
    const staticCount = 12_000;
    const publicCount = STATIC_ASSET_MAX_COUNT - staticCount - 1;
    const combined = combineArtifactCandidates(
      [{ path: "index.html", size: 1, text: "<html></html>" }],
      files(staticCount, "_next/static/chunks"),
      files(publicCount, "images"),
    );
    expect(combined).toHaveLength(STATIC_ASSET_MAX_COUNT);
    expect(validateArtifactPolicy(combined)).toMatchObject({ ok: true });
  });

  it("rejects one file past the shared 20 000 limit", () => {
    const staticCount = 12_000;
    const publicCount = STATIC_ASSET_MAX_COUNT - staticCount;
    const combined = combineArtifactCandidates(
      [{ path: "index.html", size: 1, text: "<html></html>" }],
      files(staticCount, "_next/static/chunks"),
      files(publicCount, "images"),
    );
    expect(combined).toHaveLength(STATIC_ASSET_MAX_COUNT + 1);
    expect(validateArtifactPolicy(combined)).toMatchObject({
      ok: false,
      code: "artifact_policy_failed",
      issues: expect.arrayContaining([{ field: "files", rule: "file_count_limit_exceeded" }]),
    });
  });
});
