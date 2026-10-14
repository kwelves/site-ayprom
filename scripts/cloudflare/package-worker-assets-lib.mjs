import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { buildIsolatedWranglerEnv, parseReadyUrl } from "./worker-smoke-lib.mjs";
import { probePinnedCatalogBrowser } from "./pinned-catalog-browser-probe.mjs";
import { assertPlainPath, assertPreviewStaging, prepareAdminPreviewAssets } from "./admin-preview-assets.mjs";
import { collectPackageInventory, verifyPackageIntegrity } from "./package-integrity.mjs";

const SCRIPT_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WRANGLER = path.join(
  SCRIPT_REPO,
  ".wrangler/tools/wrangler-4.135.0/node_modules/wrangler/bin/wrangler.js",
);
const SECRET = /service_role|sb_secret_|SUPABASE_SECRET_KEY|ADMIN_SESSION_SECRET|R2_SECRET_ACCESS_KEY/i;
const TEXT_FILE = /\.(?:html?|txt|css|js|mjs|json|svg|xml)$/i;
const MAX_WORKER_RAW_BYTES = 128 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REPORTS = ["crawl-report.json", "verification-report.json", "sitemap-verification.json", "link-verification.json"];

/**
 * @returns {Promise<{ ok: boolean, ready: boolean, productionReady?: boolean, code?: string, rule?: string, packageDir?: string, worker?: { rawBytes: number, gzipBytes: number }, assets?: { fileCount: number, totalBytes: number }, inputs?: string[], rawBytes?: number }>}
 */
export async function packageWorkerAssets(options) {
  return buildPackage(options, false);
}

export async function packageAdminPreview(options) {
  return buildPackage(options, true);
}

async function buildPackage({ repoRoot, stagingDir, packageDir, readCurrentRevision, pinnedRelease }, preview) {
  const pathCheck = assertPackageDirAllowed(repoRoot, packageDir, stagingDir);
  if (!pathCheck.ok) return pathCheck;
  if (pinnedRelease !== undefined && (preview || !pinnedRelease || typeof pinnedRelease !== "object"
    || Array.isArray(pinnedRelease) || Object.keys(pinnedRelease).sort().join(",") !== "id,revision,sha256"
    || !UUID.test(pinnedRelease.id) || !Number.isSafeInteger(pinnedRelease.revision)
    || pinnedRelease.revision < 0 || !SHA256.test(pinnedRelease.sha256))) {
    return { ok: false, ready: false, productionReady: false, code: "pinned_release_invalid", rule: "metadata" };
  }
  if (preview) {
    try { assertPreviewStaging(stagingDir); } catch { return invalid("preview_input_rejected"); }
  }
  const reports = readStagingReports(stagingDir);
  if (!reports.ok) return reports;
  let sourceRevision = null;
  if (!preview) {
    const report = readPublicationRevisionReport(stagingDir);
    if (!report.ok) return report;
    sourceRevision = report.revision;
    if (pinnedRelease && pinnedRelease.revision !== sourceRevision) {
      return { ok: false, ready: false, productionReady: false, code: "pinned_release_invalid", rule: "revision" };
    }
    const current = await checkCurrentRevision(readCurrentRevision, sourceRevision);
    if (!current.ok) return current;
  }
  const staging = inspectStaging(stagingDir);
  if (!staging.ok) return staging;
  if (preview) {
    try { staging.files = await prepareAdminPreviewAssets(repoRoot, staging.files); }
    catch { return invalid("preview_assets_rejected"); }
  }
  if (!existsSync(WRANGLER)) {
    return { ok: false, ready: false, code: "bundler_unavailable", rule: "wrangler_missing" };
  }

  let bundle;
  try {
    bundle = bundleWithWrangler(staging.entryPath);
  } catch {
    return { ok: false, ready: false, code: "worker_bundle_failed", rule: "dry_run_failed" };
  }
  if (SECRET.test(bundle.text) || /^\s*import\s/m.test(bundle.text)) {
    return { ok: false, ready: false, code: "worker_bundle_failed", rule: "bundle_not_self_contained" };
  }
  if (bundle.rawBytes > MAX_WORKER_RAW_BYTES) {
    return { ok: false, ready: false, code: "worker_too_large", rule: "size", rawBytes: bundle.rawBytes };
  }
  if (!preview) {
    const current = await checkCurrentRevision(readCurrentRevision, sourceRevision);
    if (!current.ok) return current;
  }

  const packageArea = path.join(path.resolve(repoRoot), "dist", "worker-packages");
  if (!existsSync(packageArea)) {
    try {
      mkdirSync(packageArea);
    } catch {
      return { ok: false, ready: false, code: "package_path_rejected", rule: "package_area_unavailable" };
    }
  }
  const finalPathCheck = assertPackageDirAllowed(repoRoot, packageDir, stagingDir);
  if (!finalPathCheck.ok) return finalPathCheck;
  try {
    mkdirSync(packageDir);
  } catch {
    return { ok: false, ready: false, code: "package_path_rejected", rule: "package_exists" };
  }
  mkdirSync(path.join(packageDir, "site"));
  for (const file of staging.files) {
    const destination = path.join(packageDir, "site", file.relativePath);
    if (!isInside(path.join(packageDir, "site"), destination)) {
      return { ok: false, ready: false, code: "invalid_staging", rule: "unsafe_site_path" };
    }
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, file.bytes, { flag: "wx" });
  }
  writeFileSync(path.join(packageDir, "worker.js"), bundle.text, { flag: "wx" });
  const config = JSON.parse(wranglerConfig());
  if (preview) {
    config.name = "ayprom-admin-preview";
    config.assets.binding = "ASSETS";
    config.assets.run_worker_first = ["/api/*", "/product/*", "/admin", "/admin/*"];
  }
  writeFileSync(path.join(packageDir, "wrangler.jsonc"), preview ? `${JSON.stringify(config, null, 2)}\n` : wranglerConfig(), { flag: "wx" });
  if (!preview) {
    writeFileSync(path.join(packageDir, "source-revision.json"),
      `${JSON.stringify({ schemaVersion: 1, revision: sourceRevision })}\n`, { flag: "wx" });
  }
  const inventory = collectPackageInventory(packageDir);
  if (!inventory.ok || !inventory.inventory.files.some((file) => file.path.startsWith("site/"))) {
    return { ok: false, ready: false, previewReady: false, productionReady: false, code: "package_integrity_failed", rule: inventory.rule ?? "empty_site" };
  }
  if (!preview) {
    const current = await checkCurrentRevision(readCurrentRevision, sourceRevision);
    if (!current.ok) return current;
  }
  const manifest = {
    schemaVersion: 1,
    ready: !preview,
    // `ready` only means the local package is structurally complete. A
    // production release still needs a separate, explicit release gate.
    productionReady: false,
    ...(!preview ? { sourceRevision } : {}),
    ...(pinnedRelease ? { release: { id: pinnedRelease.id, revision: pinnedRelease.revision,
      sha256: pinnedRelease.sha256 } } : {}),
    ...(!preview ? {
      requiredBindings: ["ASSETS", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "PUBLICATION_ID", "PUBLICATION_CAPABILITY"],
    } : {}),
    ...(preview ? {
      kind: "admin-preview", previewReady: true,
      requiredBindings: ["ASSETS", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "PUBLICATION_ID", "PUBLICATION_CAPABILITY", "ADMIN_SUPABASE_KEY", "ADMIN_COOKIE_HMAC_KEY", "ADMIN_CRYPTO_KEY"],
      optionalBindings: ["ADMIN_PASSWORD"],
    } : {}),
    worker: { rawBytes: bundle.rawBytes, gzipBytes: bundle.gzipBytes },
    assets: {
      fileCount: staging.files.length,
      totalBytes: staging.files.reduce((sum, file) => sum + file.bytes.length, 0),
    },
    inventory: inventory.inventory,
  };
  writeFileSync(path.join(packageDir, "package-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return { ok: true, ready: true, packageDir, ...manifest };
}

function assertPackageRelease(packageDir, publicationId, publicationSha256) {
  let manifest;
  try { manifest = JSON.parse(readFileSync(path.join(packageDir, "package-manifest.json"), "utf8")); }
  catch { throw new Error("packaged_release_mismatch"); }
  if (!SHA256.test(publicationSha256 ?? "") || manifest?.release?.id !== publicationId
    || manifest.release.sha256 !== publicationSha256
    || manifest.release.revision !== manifest.sourceRevision) throw new Error("packaged_release_mismatch");
}

/**
 * Starts one already-built package in local workerd and keeps it running until stop().
 * Bindings (including the publication capability) exist only in this Node process and
 * the child's command line; callers must never log them. Never reaches a remote Cloudflare.
 * @returns {Promise<{ baseUrl: string, stop: () => Promise<void> }>}
 */
export async function startPackagedWorker({ packageDir, supabaseUrl, publishableKey, publicationId, publicationCapability,
  publicationSha256 = /** @type {string | null} */ (null), requireRelease = false }) {
  if (!verifyPackageIntegrity(packageDir).ok) throw new Error("package_integrity_failed");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(publicationId ?? "")
    || typeof publicationCapability !== "string" || publicationCapability.length < 32
    || publicationCapability.length > 256) throw new Error("packaged_runtime_binding_missing");
  if (requireRelease) assertPackageRelease(packageDir, publicationId, publicationSha256);
  const runDirectory = mkdtempSync(path.join(tmpdir(), "ayprom-worker-dev-"));
  const runPackage = path.join(runDirectory, "package");
  try {
    cpSync(packageDir, runPackage, { recursive: true, errorOnExist: true, force: false });
  } catch {
    rmSync(runDirectory, { recursive: true, force: true });
    throw new Error("package_copy_failed");
  }
  const config = path.join(runPackage, "wrangler.jsonc");
  const emptyEnv = path.join(runDirectory, "empty.env");
  writeFileSync(emptyEnv, "");
  const logs = { text: "" };
  const child = spawn(process.execPath, [
    WRANGLER,
    "dev",
    "--local",
    "--config",
    config,
    "--env-file",
    emptyEnv,
    "--ip",
    "127.0.0.1",
    "--port",
    "0",
    "--inspector-ip",
    "127.0.0.1",
    "--inspector-port",
    "0",
    "--persist-to",
    path.join(runDirectory, "state"),
    "--show-interactive-dev-session=false",
    "--var",
    `SUPABASE_URL:${supabaseUrl}`,
    "--var",
    `SUPABASE_PUBLISHABLE_KEY:${publishableKey}`,
    "--var",
    `PUBLICATION_ID:${publicationId}`,
    "--var",
    `PUBLICATION_CAPABILITY:${publicationCapability}`,
  ], {
    // Wrangler writes .wrangler next to its config. Run an exact local copy,
    // leaving the original package immutable for the post-runtime check.
    cwd: runPackage,
    env: buildIsolatedWranglerEnv(process.env, path.join(runDirectory, "wrangler.log"), path.join(runDirectory, "config")),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { logs.text += chunk.toString(); });
  child.stderr.on("data", (chunk) => { logs.text += chunk.toString(); });
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(runDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        break;
      } catch {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
      }
    }
  };
  try {
    return { baseUrl: await waitForReady(child, logs), stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

export async function verifyPackagedWorker({ packageDir, supabaseUrl, publishableKey, publicationId, publicationCapability,
  searchQuery = "shaft", aliasPath = "/product/shaft", staticPath = "/catalog/category/pto/shaft",
  browserProbe = /** @type {{ query: string, expectedName: string, expectedSlug: string, productPath: string } | null} */ (null),
  publicationSha256 = /** @type {string | null} */ (null) }) {
  const worker = await startPackagedWorker({ packageDir, supabaseUrl, publishableKey, publicationId,
    publicationCapability, publicationSha256, requireRelease: browserProbe !== null });
  try {
    const { baseUrl } = worker;
    const health = await fetch(`${baseUrl}/api/health`);
    const search = await fetch(`${baseUrl}/api/catalog/search?q=${encodeURIComponent(searchQuery)}`);
    const searchBody = await search.json();
    const alias = await fetch(`${baseUrl}${aliasPath}`, { redirect: "manual" });
    const staticPage = await fetch(`${baseUrl}${staticPath}`);
    let browser = null;
    if (browserProbe) {
      try {
        browser = await probePinnedCatalogBrowser({
          baseUrl, query: browserProbe.query, expectedName: browserProbe.expectedName,
          expectedSlug: browserProbe.expectedSlug, productPath: browserProbe.productPath,
          sensitiveValue: publicationCapability,
        });
      } catch (error) {
        const match = /^pinned_browser_probe_failed:(preflight|browser_start|catalog_open|search|product_click|product_url|product_heading|reload|empty):(product_href|search_url|browser_runtime_error|catalog_status|reload_status|empty_status|search_status|search_contract|response_leaked_binding|timeout|other)$/.exec(
          error instanceof Error ? error.message : "",
        );
        browser = { ok: false, stage: match?.[1] ?? "unknown", reason: match?.[2] ?? "other" };
      }
    }
    return {
      health: { status: health.status },
      search: { status: search.status, slug: searchBody.items?.[0]?.slug ?? null },
      alias: { status: alias.status, location: new URL(alias.headers.get("location") ?? "http://invalid/").pathname },
      static: { status: staticPage.status, contentType: staticPage.headers.get("content-type") },
      ...(browser ? { browser } : {}),
    };
  } finally {
    await worker.stop();
  }
}

function assertPackageDirAllowed(repoRoot, packageDir, stagingDir) {
  const repo = path.resolve(repoRoot);
  const target = path.resolve(packageDir);
  const staging = path.resolve(stagingDir);
  const dist = path.join(repo, "dist");
  const area = path.join(dist, "worker-packages");
  const site = path.join(dist, "site");
  if ([repo, dist, area, site, staging].some((forbidden) => samePath(target, forbidden)) || isInside(site, target) || isInside(staging, target)) {
    return { ok: false, ready: false, code: "package_path_rejected", rule: "forbidden_target" };
  }
  const relative = path.relative(area, target);
  const segments = relative.split(path.sep).filter(Boolean);
  if (relative.startsWith("..") || path.isAbsolute(relative) || segments.length !== 1) {
    return { ok: false, ready: false, code: "package_path_rejected", rule: "outside_package_area" };
  }
  if (existsSync(target)) {
    return { ok: false, ready: false, code: "package_path_rejected", rule: "package_exists" };
  }
  let realRepo;
  try {
    realRepo = realpathIfReal(repo);
  } catch {
    return { ok: false, ready: false, code: "package_path_rejected", rule: "outside_dist_realpath" };
  }
  let cursor = repo;
  for (const segment of ["dist", "worker-packages"]) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = lstatSync(cursor);
    } catch {
      if (segment === "worker-packages") continue;
      return { ok: false, ready: false, code: "package_path_rejected", rule: "package_area_missing" };
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return { ok: false, ready: false, code: "package_path_rejected", rule: "reparse_point" };
    }
    const realCursor = realpathIfReal(cursor);
    if (!isInside(realRepo, realCursor) || samePath(realCursor, realRepo)) {
      return { ok: false, ready: false, code: "package_path_rejected", rule: "outside_dist_realpath" };
    }
    if (existsSync(site)) {
      const realSite = realpathIfReal(site);
      if (samePath(realCursor, realSite) || isInside(realSite, realCursor)) {
        return { ok: false, ready: false, code: "package_path_rejected", rule: "site_tree_forbidden" };
      }
    }
  }
  return { ok: true };
}

function readStagingReports(stagingDir) {
  const meta = path.join(stagingDir, "meta");
  let parsed;
  try {
    parsed = Object.fromEntries(REPORTS.map((name) => [name, JSON.parse(readFileSync(path.join(meta, name), "utf8"))]));
  } catch {
    return { ok: false, ready: false, code: "staging_not_verified", rule: "missing_report" };
  }
  const summary = parsed["crawl-report.json"]?.summary;
  const verified = summary?.failed === 0
    && summary?.written === summary?.routes
    && parsed["verification-report.json"]?.ok === true
    && parsed["sitemap-verification.json"]?.ok === true
    && parsed["link-verification.json"]?.ok === true;
  if (!verified) return { ok: false, ready: false, code: "staging_not_verified", rule: "failed_report" };
  return { ok: true };
}

function readPublicationRevisionReport(stagingDir) {
  const file = path.join(stagingDir, "meta", "publication-revision-report.json");
  try {
    assertPlainPath(file);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > 128) throw new Error();
    const report = JSON.parse(readFileSync(file, "utf8"));
    if (report?.schemaVersion !== 1 || report.ok !== true
      || !Number.isSafeInteger(report.revision) || report.revision < 0) throw new Error();
    return { ok: true, revision: report.revision };
  } catch {
    return { ok: false, ready: false, code: "publication_revision_unavailable" };
  }
}

async function checkCurrentRevision(readCurrentRevision, sourceRevision) {
  try {
    if (typeof readCurrentRevision !== "function") throw new Error();
    const current = await readCurrentRevision();
    if (!Number.isSafeInteger(current) || current < 0) throw new Error();
    if (current !== sourceRevision) return { ok: false, ready: false, code: "publication_revision_changed" };
    return { ok: true };
  } catch {
    return { ok: false, ready: false, code: "publication_revision_unavailable" };
  }
}

function inspectStaging(stagingDir) {
  const siteDir = path.join(stagingDir, "site");
  const entryPath = path.join(stagingDir, "meta", "alias-worker-entry.mjs");
  let entrySource;
  try {
    if (!lstatSync(siteDir).isDirectory()) return invalid("missing_site");
    entrySource = readFileSync(entryPath, "utf8");
  } catch {
    return invalid("missing_worker_entry");
  }
  if (SECRET.test(entrySource)) return invalid("forbidden_content");
  const files = [];
  try {
    collectSiteFiles(siteDir, siteDir, files);
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "invalid_site");
  }
  if (!files.some((file) => file.relativePath === "index.html")) return invalid("missing_index");
  return { ok: true, entryPath, entrySource, files };
}

function collectSiteFiles(siteDir, directory, files) {
  for (const name of readdirSync(directory)) {
    const absolute = path.join(directory, name);
    const stat = lstatSync(absolute);
    const relativePath = path.relative(siteDir, absolute).replaceAll("\\", "/");
    if (stat.isSymbolicLink()) throw new Error("symlink");
    if (stat.isDirectory()) {
      if (relativePath === "meta" || relativePath.startsWith("meta/")) throw new Error("meta_in_site");
      collectSiteFiles(siteDir, absolute, files);
      continue;
    }
    if (!stat.isFile()) throw new Error("invalid_site_entry");
    if (isForbiddenSitePath(relativePath)) throw new Error("forbidden_path");
    const bytes = readFileSync(absolute);
    if (TEXT_FILE.test(relativePath) && SECRET.test(bytes.toString("utf8"))) throw new Error("forbidden_content");
    files.push({ relativePath, bytes });
  }
}

function isForbiddenSitePath(relativePath) {
  const normalized = relativePath.toLowerCase();
  return normalized.endsWith(".map")
    || normalized.includes("/.env")
    || normalized.startsWith(".env")
    || normalized.endsWith("/_worker.js")
    || normalized === "_worker.js"
    || normalized.split("/").includes("meta");
}

function bundleWithWrangler(entryPath) {
  const runDirectory = mkdtempSync(path.join(tmpdir(), "ayprom-worker-bundle-"));
  try {
    const configPath = path.join(runDirectory, "wrangler.json");
    const emptyEnv = path.join(runDirectory, "empty.env");
    const outdir = path.join(runDirectory, "out");
    writeFileSync(emptyEnv, "");
    writeFileSync(configPath, JSON.stringify({
      name: "ayprom-static-worker-package",
      main: entryPath,
      compatibility_date: "2026-09-19",
      compatibility_flags: ["nodejs_compat"],
      workers_dev: false,
    }));
    mkdirSync(outdir);
    const result = spawnSync(process.execPath, [
      WRANGLER, "deploy", "--dry-run", "--config", configPath, "--env-file", emptyEnv, "--outdir", outdir,
    ], {
      cwd: SCRIPT_REPO,
      env: buildIsolatedWranglerEnv(process.env, path.join(runDirectory, "wrangler.log"), path.join(runDirectory, "config")),
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
    });
    const bundleName = readdirSync(outdir).find((name) => name.endsWith(".js") && !name.endsWith(".map"));
    const bundlePath = bundleName ? path.join(outdir, bundleName) : "";
    if (result.status !== 0 || bundlePath === "" || !existsSync(bundlePath)) throw new Error("dry_run_failed");
    const text = readFileSync(bundlePath, "utf8").replace(/\/\/# sourceMappingURL=\S+/g, "");
    return { text, rawBytes: Buffer.byteLength(text), gzipBytes: gzipSync(Buffer.from(text)).length };
  } finally {
    rmSync(runDirectory, { recursive: true, force: true });
  }
}

function waitForReady(child, logs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("workerd_not_ready")), 60_000);
    const poll = setInterval(() => {
      if (child.exitCode !== null) {
        clearInterval(poll);
        clearTimeout(timer);
        reject(new Error("workerd_exited"));
        return;
      }
      const ready = parseReadyUrl(logs.text);
      if (ready) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve(ready);
      }
    }, 200);
  });
}

function wranglerConfig() {
  return `{
  "name": "ayprom-static-worker-package",
  "main": "worker.js",
  "compatibility_date": "2026-09-19",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "assets": {
    "directory": "site",
    "html_handling": "drop-trailing-slash",
    "not_found_handling": "404-page",
    "run_worker_first": ["/api/*", "/product/*"]
  }
}
`;
}

function invalid(rule) {
  return { ok: false, ready: false, code: "invalid_staging", rule };
}

function realpathIfReal(target) {
  return realpathSync(target);
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isInside(parent, child) {
  if (samePath(parent, child)) return true;
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
