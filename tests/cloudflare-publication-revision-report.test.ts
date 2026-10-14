import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { finalizeRevisionedBuild, writePublicationRevisionReport } from "../scripts/cloudflare/publication-revision-report.mjs";

const created: string[] = [];
afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "ayprom-revision-report-"));
  created.push(repoRoot);
  const stagingDir = path.join(repoRoot, "dist", "staging", "run-1");
  mkdirSync(path.join(stagingDir, "meta"), { recursive: true });
  mkdirSync(path.join(stagingDir, "site"));
  return { repoRoot, stagingDir, file: path.join(stagingDir, "meta", "publication-revision-report.json") };
}

describe("local publication revision report", () => {
  it("writes one bounded proof only inside the fresh staging meta directory", () => {
    const target = fixture();
    writePublicationRevisionReport({ repoRoot: target.repoRoot, stagingDir: target.stagingDir, revision: 7 });
    expect(JSON.parse(readFileSync(target.file, "utf8"))).toEqual({ schemaVersion: 1, ok: true, revision: 7 });
  });

  it("does not overwrite a prior proof", () => {
    const target = fixture();
    writeFileSync(target.file, "keep-me");
    expect(() => writePublicationRevisionReport({ repoRoot: target.repoRoot, stagingDir: target.stagingDir, revision: 8 }))
      .toThrow("publication_revision_report_failed");
    expect(readFileSync(target.file, "utf8")).toBe("keep-me");
  });

  it("refuses a path outside staging or an invalid revision before writing", () => {
    const target = fixture();
    expect(() => writePublicationRevisionReport({ repoRoot: target.repoRoot, stagingDir: target.repoRoot, revision: 7 }))
      .toThrow("publication_revision_report_failed");
    expect(() => writePublicationRevisionReport({ repoRoot: target.repoRoot, stagingDir: target.stagingDir, revision: -1 }))
      .toThrow("publication_revision_report_failed");
    expect(existsSync(target.file)).toBe(false);
  });

  it("turns a successful crawl into a proof-bearing result", () => {
    const target = fixture();
    const result = finalizeRevisionedBuild({ repoRoot: target.repoRoot, result: { ok: true, revision: 7, stagingDir: target.stagingDir } });
    expect(result).toEqual({ ok: true, revision: 7, stagingDir: target.stagingDir });
    expect(JSON.parse(readFileSync(target.file, "utf8")).revision).toBe(7);
  });

  it("never writes a proof for a stale crawl", () => {
    const target = fixture();
    const failed = { ok: false, code: "publication_revision_changed", stage: "after_crawl", stagingDir: target.stagingDir };
    expect(finalizeRevisionedBuild({ repoRoot: target.repoRoot, result: failed })).toEqual(failed);
    expect(existsSync(target.file)).toBe(false);
  });

  it("does not claim success when proof writing fails", () => {
    const target = fixture();
    writeFileSync(target.file, "keep-me");
    const result = finalizeRevisionedBuild({ repoRoot: target.repoRoot, result: { ok: true, revision: 7, stagingDir: target.stagingDir } });
    expect(result).toEqual({ ok: false, code: "publication_revision_report_failed", stage: "report", stagingDir: target.stagingDir });
    expect(readFileSync(target.file, "utf8")).toBe("keep-me");
  });
});
