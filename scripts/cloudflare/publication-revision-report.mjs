import { lstatSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertPlainPath } from "./admin-preview-assets.mjs";

// A new proof belongs only to one existing producer-created staging run.
// It is not a release authorization; the packager rereads the public RPC.
export function writePublicationRevisionReport({ repoRoot, stagingDir, revision }) {
  try {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error();
    const root = path.resolve(repoRoot);
    const stage = path.resolve(stagingDir);
    const stagingRoot = path.join(root, "dist", "staging");
    const relative = path.relative(stagingRoot, stage);
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,80}$/.test(relative)) throw new Error();
    const metaDir = path.join(stage, "meta");
    const siteDir = path.join(stage, "site");
    assertPlainPath(metaDir);
    assertPlainPath(siteDir);
    if (!lstatSync(metaDir).isDirectory() || !lstatSync(siteDir).isDirectory()) throw new Error();
    writeFileSync(path.join(metaDir, "publication-revision-report.json"),
      `${JSON.stringify({ schemaVersion: 1, ok: true, revision })}\n`, { flag: "wx" });
  } catch {
    throw new Error("publication_revision_report_failed");
  }
}

export function finalizeRevisionedBuild({ repoRoot, result }) {
  if (!result.ok) return result;
  try {
    writePublicationRevisionReport({ repoRoot, stagingDir: result.stagingDir, revision: result.revision });
    return result;
  } catch {
    return { ok: false, code: "publication_revision_report_failed", stage: "report", stagingDir: result.stagingDir };
  }
}
