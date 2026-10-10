import { createHash } from "node:crypto";
import path from "node:path";
import { readBoundedTextFile, verifyPackageIntegrity } from "./package-integrity.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const BINDINGS = ["ASSETS", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "PUBLICATION_ID", "PUBLICATION_CAPABILITY"];
/** @returns {{ok:false, ready:false, productionReady:false, code:string}} */
const rejected = () => ({ ok: false, ready: false, productionReady: false, code: "publication_package_rejected" });
const keys = (value, expected) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === [...expected].sort().join(",");
const count = (value) => Number.isSafeInteger(value) && value >= 0;

/**
 * Read-only package identity. Not a signature, upload, preview smoke, or publication gate.
 * @returns {Promise<{ok:true, ready:true, productionReady:false, releaseId:string, revision:number,
 * releaseSha256:string, packageSha256:string} | {ok:false, ready:false, productionReady:false, code:string}>}
 */
export async function inspectPublicationPackage(packageDir) {
  try {
    if (typeof packageDir !== "string" || !packageDir.trim() || !verifyPackageIntegrity(packageDir).ok) return rejected();
    const root = path.resolve(packageDir);
    const manifestFile = path.join(root, "package-manifest.json");
    const metadata = readBoundedTextFile(manifestFile);
    if (!metadata.ok) return rejected();
    const manifest = JSON.parse(metadata.text);
    if (!keys(manifest, ["schemaVersion", "ready", "productionReady", "sourceRevision", "release",
      "requiredBindings", "worker", "assets", "inventory"]) || manifest.schemaVersion !== 1
      || manifest.ready !== true || manifest.productionReady !== false || !count(manifest.sourceRevision)
      || !keys(manifest.release, ["id", "revision", "sha256"]) || !UUID.test(manifest.release.id)
      || manifest.release.revision !== manifest.sourceRevision || !HASH.test(manifest.release.sha256)
      || JSON.stringify(manifest.requiredBindings) !== JSON.stringify(BINDINGS)
      || !keys(manifest.worker, ["rawBytes", "gzipBytes"]) || !count(manifest.worker.rawBytes)
      || manifest.worker.rawBytes === 0 || !count(manifest.worker.gzipBytes) || manifest.worker.gzipBytes === 0
      || !keys(manifest.assets, ["fileCount", "totalBytes"]) || !count(manifest.assets.fileCount)
      || !count(manifest.assets.totalBytes) || !keys(manifest.inventory, ["files"])) return rejected();

    const files = manifest.inventory.files;
    if (!Array.isArray(files)) return rejected();
    const top = new Set(["worker.js", "wrangler.jsonc", "source-revision.json"]);
    const seen = new Set();
    let assetCount = 0;
    let assetBytes = 0;
    for (const file of files) {
      if (!keys(file, ["path", "bytes", "sha256"]) || !count(file.bytes) || !HASH.test(file.sha256)) return rejected();
      if (file.path.startsWith("site/")) {
        // Files outside the public tree are limited to three known runtime inputs.
        if (/\.map$/i.test(file.path) || /(?:^|\/)\.env(?:\.|$)/i.test(file.path)) return rejected();
        assetCount += 1;
        assetBytes += file.bytes;
      } else if (!top.has(file.path)) return rejected();
      seen.add(file.path);
    }
    if ([...top].some((name) => !seen.has(name)) || assetCount !== manifest.assets.fileCount
      || assetBytes !== manifest.assets.totalBytes || assetCount === 0
      || files.find((file) => file.path === "worker.js").bytes !== manifest.worker.rawBytes) return rejected();

    const revisionFile = readBoundedTextFile(path.join(root, "source-revision.json"));
    const configFile = readBoundedTextFile(path.join(root, "wrangler.jsonc"));
    if (!revisionFile.ok || !configFile.ok) return rejected();
    const revision = JSON.parse(revisionFile.text);
    const config = JSON.parse(configFile.text);
    if (!keys(revision, ["schemaVersion", "revision"]) || revision.schemaVersion !== 1
      || revision.revision !== manifest.sourceRevision || !validConfig(config)) return rejected();

    // Include the manifest bytes: the ordinary inventory excludes its own manifest.
    // Thus valid metadata changes cannot retain a previous package identity.
    const packageSha256 = createHash("sha256").update("ayprom-publication-package:v1\n")
      .update(metadata.text, "utf8").digest("hex");
    if (!verifyPackageIntegrity(root).ok) return rejected();
    const rechecked = readBoundedTextFile(manifestFile);
    if (!rechecked.ok || rechecked.text !== metadata.text) return rejected();
    return { ok: true, ready: true, productionReady: false, releaseId: manifest.release.id,
      revision: manifest.sourceRevision, releaseSha256: manifest.release.sha256, packageSha256 };
  } catch { return rejected(); }
}

function validConfig(config) {
  return keys(config, ["name", "main", "compatibility_date", "compatibility_flags", "workers_dev", "assets"])
    && config.name === "ayprom-static-worker-package" && config.main === "worker.js"
    && config.compatibility_date === "2026-09-19"
    && JSON.stringify(config.compatibility_flags) === '["nodejs_compat"]' && config.workers_dev === false
    && keys(config.assets, ["directory", "html_handling", "not_found_handling", "run_worker_first"])
    && config.assets.directory === "site" && config.assets.html_handling === "drop-trailing-slash"
    && config.assets.not_found_handling === "404-page"
    && JSON.stringify(config.assets.run_worker_first) === '["/api/*","/product/*"]';
}
