import path from "node:path";
import { readBoundedTextFile, verifyPackageIntegrity } from "./package-integrity.mjs";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

// Read-only local selection gate. No Worker startup, deploy, or selection write.
export async function resolvePublicPackage({ repoRoot, packageName, readCurrentRevision }) {
  if (typeof packageName !== "string" || !NAME.test(packageName)) {
    return { ok: false, code: "package_rejected" };
  }
  const area = path.join(path.resolve(repoRoot), "dist", "worker-packages");
  const packageDir = path.join(area, packageName);
  if (path.relative(area, packageDir) !== packageName) return { ok: false, code: "package_rejected" };
  try {
    if (!verifyPackageIntegrity(packageDir).ok) return { ok: false, code: "package_integrity_failed" };
    const manifestFile = readBoundedTextFile(path.join(packageDir, "package-manifest.json"));
    const configFile = readBoundedTextFile(path.join(packageDir, "wrangler.jsonc"));
    const sourceFile = readBoundedTextFile(path.join(packageDir, "source-revision.json"));
    if (!manifestFile.ok || !configFile.ok || !sourceFile.ok || sourceFile.text.length > 128) {
      return { ok: false, code: "package_integrity_failed" };
    }
    const manifest = JSON.parse(manifestFile.text);
    const config = JSON.parse(configFile.text);
    const source = JSON.parse(sourceFile.text);
    if (!Number.isSafeInteger(manifest.sourceRevision) || manifest.sourceRevision < 0) {
      return { ok: false, code: "publication_revision_unavailable" };
    }
    if (source.schemaVersion !== 1 || !Number.isSafeInteger(source.revision) || source.revision < 0
      || source.revision !== manifest.sourceRevision) return { ok: false, code: "package_integrity_failed" };
    if (manifest.schemaVersion !== 1 || manifest.ready !== true || manifest.productionReady !== false
      || manifest.kind !== undefined
      || config.main !== "worker.js" || config.workers_dev !== false || config.vars !== undefined
      || config.assets?.directory !== "site"
      || JSON.stringify(config.assets.run_worker_first) !== '["/api/*","/product/*"]') {
      return { ok: false, code: "publication_revision_unavailable" };
    }
    if (typeof readCurrentRevision !== "function") return { ok: false, code: "publication_revision_unavailable" };
    let current;
    try { current = await readCurrentRevision(); }
    catch { return { ok: false, code: "publication_revision_unavailable" }; }
    if (!Number.isSafeInteger(current) || current < 0) return { ok: false, code: "publication_revision_unavailable" };
    if (current !== manifest.sourceRevision) return { ok: false, code: "publication_revision_changed" };
    const after = readBoundedTextFile(path.join(packageDir, "package-manifest.json"));
    const sourceAfter = readBoundedTextFile(path.join(packageDir, "source-revision.json"));
    if (!after.ok || after.text !== manifestFile.text || !sourceAfter.ok || sourceAfter.text !== sourceFile.text
      || !verifyPackageIntegrity(packageDir).ok) {
      return { ok: false, code: "package_integrity_failed" };
    }
    return { ok: true, packageDir, sourceRevision: current, productionReady: false };
  } catch {
    return { ok: false, code: "package_integrity_failed" };
  }
}
