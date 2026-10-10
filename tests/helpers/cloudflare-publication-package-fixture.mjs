import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { collectPackageInventory } from "../../scripts/cloudflare/package-integrity.mjs";
import { inspectPublicationPackage } from "../../scripts/cloudflare/publication-package-inspector.mjs";

// Integrity-contract fixture only. Its empty Worker is not a runnable catalog.
export async function writeCoordinatorFixturePackage(directory, release) {
  if (!path.isAbsolute(directory) || path.dirname(directory) === directory || existsSync(directory)) {
    throw new Error("coordinator_fixture_directory_invalid");
  }
  mkdirSync(path.join(directory,"site"),{recursive:true});
  const worker="export default {};\n",html="<h1>Local coordinator fixture</h1>";
  writeFileSync(path.join(directory,"worker.js"),worker);
  writeFileSync(path.join(directory,"site/index.html"),html);
  writeFileSync(path.join(directory,"source-revision.json"),JSON.stringify({schemaVersion:1,revision:release.revision}));
  writeFileSync(path.join(directory,"wrangler.jsonc"),JSON.stringify({
    name:"ayprom-static-worker-package",main:"worker.js",compatibility_date:"2026-09-19",
    compatibility_flags:["nodejs_compat"],workers_dev:false,assets:{directory:"site",html_handling:"drop-trailing-slash",
      not_found_handling:"404-page",run_worker_first:["/api/*","/product/*"]},
  }));
  const inventory=collectPackageInventory(directory);
  writeFileSync(path.join(directory,"package-manifest.json"),JSON.stringify({
    schemaVersion:1,ready:true,productionReady:false,sourceRevision:release.revision,
    release:{id:release.releaseId,revision:release.revision,sha256:release.releaseSha256},
    requiredBindings:["ASSETS","SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","PUBLICATION_ID","PUBLICATION_CAPABILITY"],
    worker:{rawBytes:Buffer.byteLength(worker),gzipBytes:gzipSync(worker).length},
    assets:{fileCount:1,totalBytes:Buffer.byteLength(html)},inventory:inventory.inventory,
  }));
  const inspected=await inspectPublicationPackage(directory);
  if(!inspected.ok)throw new Error("coordinator_fixture_package_rejected");
  return {packageDir:directory,releaseId:inspected.releaseId,revision:inspected.revision,
    releaseSha256:inspected.releaseSha256,packageSha256:inspected.packageSha256};
}
