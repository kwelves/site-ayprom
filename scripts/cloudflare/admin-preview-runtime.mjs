import { lstatSync } from "node:fs";
import path from "node:path";
import { assertPlainPath } from "./admin-preview-assets.mjs";
import { readBoundedTextFile, verifyPackageIntegrity } from "./package-integrity.mjs";

// Return only known local runtime fields. Never inherit deploy/account settings.
export function readAdminPreviewRuntime(packageDir) {
  try {
    const root = path.resolve(packageDir);
    for (const name of ["package-manifest.json", "wrangler.jsonc", "worker.js", "site"]) assertPlainPath(path.join(root, name));
    if (!lstatSync(path.join(root, "worker.js")).isFile() || !lstatSync(path.join(root, "site")).isDirectory()) throw new Error();
    const manifestFile = readBoundedTextFile(path.join(root, "package-manifest.json"));
    const configFile = readBoundedTextFile(path.join(root, "wrangler.jsonc"));
    if (!manifestFile.ok || !configFile.ok) throw new Error("package_integrity_failed");
    const manifest = JSON.parse(manifestFile.text);
    const config = JSON.parse(configFile.text);
    const assets = config.assets;
    if (manifest.kind !== "admin-preview" || manifest.ready !== false || manifest.previewReady !== true || manifest.productionReady !== false
      || config.main !== "worker.js" || config.vars !== undefined || config.workers_dev !== false
      || config.compatibility_date !== "2026-09-19" || JSON.stringify(config.compatibility_flags) !== '["nodejs_compat"]'
      || assets?.directory !== "site" || assets.binding !== "ASSETS"
      || assets.html_handling !== "drop-trailing-slash" || assets.not_found_handling !== "404-page"
      || JSON.stringify(assets.run_worker_first) !== '["/api/*","/product/*","/admin","/admin/*"]') throw new Error();
    const integrity = verifyPackageIntegrity(root);
    if (!integrity.ok) throw new Error(integrity.rule === "missing_inventory" ? "missing_inventory" : "package_integrity_failed");
    return {
      name: "ayprom-admin-package-local-smoke",
      main: path.join(root, "worker.js"),
      compatibility_date: config.compatibility_date,
      compatibility_flags: config.compatibility_flags,
      workers_dev: false,
      assets: {
        directory: path.join(root, "site"), binding: "ASSETS",
        html_handling: assets.html_handling, not_found_handling: assets.not_found_handling,
        run_worker_first: assets.run_worker_first,
      },
    };
  } catch (error) {
    if (error instanceof Error && (error.message === "missing_inventory" || error.message === "package_integrity_failed")) throw error;
    throw new Error("invalid_admin_preview");
  }
}
