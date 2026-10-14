// Reusable core of the Workers Builds entry. Explicit build mode only.
// Never deploys, uploads versions, calls a Deploy Hook, or uses the Cloudflare API.
// A failed run leaves the previous package directory unchanged. productionReady stays false.
// The pinned-release identity (including its capability) is returned only to the calling
// Node process; it is never printed, written to the package or put into a report.
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packageWorkerAssets, verifyPackagedWorker } from "./package-worker-assets-lib.mjs";
import { verifyPackageIntegrity } from "./package-integrity.mjs";
import { finalizeRevisionedBuild } from "./publication-revision-report.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
register("./static-producer-loader.mjs", { parentURL: import.meta.url, data: { srcRoot: path.join(repo, "src") } });
const load = (name) => import(pathToFileURL(path.join(repo, "src/cloudflare/static-build", name)).href);
const { readPublicContentRevision } = await load("producer/publication-revision.ts");
const { createWorkersBuildChildEnv, parseWorkersBuildAllowlist, resolveWorkersBuildBinding } = await load("producer/workers-build-config.ts");
const { runWorkersBuild } = await load("producer/workers-build-runner.ts");
const { verifyPinnedCandidateFinalState } = await load("producer/pinned-candidate-finalization.ts");
const { preparePinnedCatalogBuild } = await load("producer/pinned-build-preparation.ts");
const { captureCatalogPublication, createCatalogPublicationCaptureSource } = await load("producer/catalog-publication-capture.ts");
const { exportCatalogPublication, createCatalogPublicationExportSource } = await load("producer/catalog-publication-export.ts");
const { writeCatalogPublicationFile, loadCatalogPublicationFile } = await import(pathToFileURL(path.join(repo, "src/lib/catalog-publication-file.ts")).href);

const kind = "workers-build-runner";
export const DEFAULT_PINNED_PROBE = Object.freeze({ query: "Later edit", expectedName: "Later edit",
  slug: "capture-http-product", categorySlug: "capture-http" });

/**
 * @param {{ env: Record<string, string | undefined>, argv: string[], emit?: (line: string) => void,
 *   probe?: { query: string, expectedName: string, slug?: string, categorySlug?: string } }} options
 * @returns {Promise<{ outcome: Record<string, unknown> & { ok: boolean },
 *   pinned: { releaseId: string, capability: string, publicationSha256: string, revision: number } | null }>}
 */
export async function runWorkersBuildEntry({ env, argv, emit = () => {}, probe = DEFAULT_PINNED_PROBE }) {
  const publishableKey = env.AYPROM_WORKERS_BUILD_SUPABASE_PUBLISHABLE_KEY ?? "";
  const supabaseUrl = env.AYPROM_WORKERS_BUILD_SUPABASE_URL ?? "";
  const allowlist = parseWorkersBuildAllowlist(env.AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST);
  const source = { mode: env.AYPROM_WORKERS_BUILD_MODE ?? "", supabaseUrl, publishableKey, allowlist };
  const resolved = resolveWorkersBuildBinding(source);
  const localPinned = argv.includes("--local-pinned");
  // staging-pinned: the same sealed-snapshot build against ONE explicitly allowlisted remote STAGING catalog.
  const stagingPinned = argv.includes("--staging-pinned");
  const pinnedFlow = localPinned || stagingPinned;
  const secrets = [publishableKey, supabaseUrl].filter((secret) => secret.length >= 8);
  const redact = (text) => secrets.reduce((current, secret) => current.replaceAll(secret, "[redacted]"), text);

  function print(value) {
    emit(`${redact(JSON.stringify({ kind, ...value }))}\n`);
  }
  function argument(flag) {
    const index = argv.indexOf(flag);
    return index === -1 ? "" : argv[index + 1] ?? "";
  }
  function runNode(args, childEnv, timeout) {
    const result = spawnSync(process.execPath, args, {
      cwd: repo, env: childEnv, encoding: "utf8", windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024,
    });
    if (result.status !== 0 || result.error) {
      const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.slice(-24000);
      process.stderr.write(`${JSON.stringify({ stage: args.at(-1), diagnostic: redact(diagnostic) })}\n`);
    }
    return result.status === 0 && !result.error;
  }

  async function main() {
    const publishedPackageDir = argument("--published");
    const packageDir = argument("--package");
    if (!publishedPackageDir || !packageDir) {
      return { outcome: { kind, ok: false, code: "invalid_arguments", stage: "preflight", stagingDir: null, packageDir: null,
        productionReady: false, externalPublication: false, publishedPackageUnchanged: true }, pinned: null };
    }
    if (localPinned && stagingPinned) {
      return { outcome: { kind, ok: false, code: "pinned_mode_conflict", stage: "preflight",
        stagingDir: null, packageDir: null, productionReady: false, externalPublication: false,
        publishedPackageUnchanged: true }, pinned: null };
    }
    if (stagingPinned && !(resolved.ok && resolved.mode === "workers-build")) {
      return { outcome: { kind, ok: false, code: "staging_pinned_requires_allowlisted_remote", stage: "preflight",
        stagingDir: null, packageDir: null, productionReady: false, externalPublication: false,
        publishedPackageUnchanged: true }, pinned: null };
    }
    if (localPinned && !(resolved.ok && resolved.mode === "loopback-fixture"
      && resolved.url === "http://127.0.0.1:56421")) {
      return { outcome: { kind, ok: false, code: "local_pinned_requires_isolated_loopback", stage: "preflight",
        stagingDir: null, packageDir: null, productionReady: false, externalPublication: false,
        publishedPackageUnchanged: true }, pinned: null };
    }
    const cacheNonce = randomBytes(16).toString("hex");
    let initialRevision = null;
    let pinnedPublication = null;
    let pinnedIdentity = null;
    const buildEnv = () => {
      if (!resolved.ok) return { PATH: env.PATH ?? "" };
      return createWorkersBuildChildEnv({
        parent: env,
        binding: resolved,
        allowlist,
        cacheNonce,
        ...(pinnedPublication ? { pinnedPublication: pinnedPublication.file } : {}),
      });
    };
    const crawlEnv = () => {
      const childEnv = buildEnv();
      if (resolved.ok && resolved.mode === "loopback-fixture") {
        childEnv.NEXT_PUBLIC_SUPABASE_URL = resolved.url;
        childEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = resolved.key;
      }
      return childEnv;
    };
    const sealedSourceMatches = async (revision) => {
      if (!pinnedPublication || !pinnedIdentity) return false;
      try {
        const exportFile = await loadCatalogPublicationFile({ repoRoot: repo, ...pinnedPublication.file });
        return exportFile.releaseId === pinnedIdentity.releaseId && exportFile.revision === revision
          && exportFile.sha256 === pinnedPublication.publicationSha256;
      } catch { return false; }
    };
    const result = await runWorkersBuild({
      repoRoot: repo,
      publishedPackageDir: path.resolve(publishedPackageDir),
      packageDir: path.resolve(packageDir),
      source,
      envFileNames: [".env", ".env.local", ".env.production", ".env.production.local"].filter((name) => existsSync(path.join(repo, name))),
      readRevision: async () => {
        if (!resolved.ok) return Promise.reject(new Error("binding_rejected"));
        const revision = await readPublicContentRevision({ url: resolved.url, key: resolved.key });
        if (initialRevision === null) initialRevision = revision;
        return revision;
      },
      buildStaticFiles: async () => {
        if (!resolved.ok) return false;
        if (pinnedFlow) {
          if (initialRevision === null) return false;
          const captureSource = createCatalogPublicationCaptureSource({
            SUPABASE_URL: resolved.url,
            ADMIN_SUPABASE_KEY: env.ADMIN_SUPABASE_KEY ?? "",
          });
          const exportSource = createCatalogPublicationExportSource(source);
          pinnedIdentity = { releaseId: randomUUID(), capability: randomBytes(32).toString("hex") };
          pinnedPublication = await preparePinnedCatalogBuild({
            expectedRevision: initialRevision,
            identity: pinnedIdentity,
            capture: (request) => captureCatalogPublication({ ...request, source: captureSource }),
            exportRelease: (receipt, capability) => exportCatalogPublication({ receipt, capability,
              source: exportSource }),
            write: (publication) => writeCatalogPublicationFile({ repoRoot: repo, publication }),
          });
        }
        return runNode([path.join(repo, "node_modules/next/dist/bin/next"), "build"],
          buildEnv(), 600_000);
      },
      crawlToStaging: async () => {
        if (!resolved.ok) return { ok: false, stagingDir: null };
        const crawl = spawnSync(process.execPath, [path.join(repo, "scripts/cloudflare/local-static-producer.mjs")], {
          cwd: repo,
          env: crawlEnv(),
          encoding: "utf8",
          windowsHide: true,
          timeout: 700_000,
          maxBuffer: 2 * 1024 * 1024,
        });
        if (crawl.status !== 0 || crawl.error) {
          const diagnostic = `${crawl.stdout ?? ""}\n${crawl.stderr ?? ""}`.slice(-24000);
          process.stderr.write(`${JSON.stringify({ stage: "crawl", diagnostic: redact(diagnostic) })}\n`);
        }
        let summary = null;
        try { summary = JSON.parse(crawl.stdout?.trim() ?? ""); } catch { summary = null; }
        return {
          ok: crawl.status === 0 && !crawl.error && summary?.kind === "local-full-crawl" && summary.ok === true,
          stagingDir: typeof summary?.stagingDir === "string" ? summary.stagingDir : null,
        };
      },
      finalize: ({ stagingDir, revision }) => {
        finalizeRevisionedBuild({ repoRoot: repo, result: { ok: true, revision, stagingDir } });
      },
      packageStaging: async ({ stagingDir, packageDir: output, revision }) => {
        if (!resolved.ok) return Promise.resolve({ ok: false, ready: false, productionReady: false });
        if (pinnedFlow && (!pinnedIdentity || !pinnedPublication || !await sealedSourceMatches(revision))) {
          return { ok: false, ready: false, productionReady: false };
        }
        return packageWorkerAssets({
          repoRoot: repo,
          stagingDir,
          packageDir: output,
          readCurrentRevision: () => readPublicContentRevision({ url: resolved.url, key: resolved.key }),
          ...(pinnedFlow ? { pinnedRelease: { id: pinnedIdentity.releaseId, revision,
            sha256: pinnedPublication.publicationSha256 } } : {}),
        });
      },
      ...(pinnedFlow ? { verifySealedSource: sealedSourceMatches } : {}),
    });
    let outcome = { kind, ...result };
    if (pinnedFlow && result.ok) {
      let pinnedRuntimeOk = false;
      let pinnedBrowserOk = false;
      let pinnedBrowserStage = null;
      let pinnedBrowserReason = null;
      let pinnedRuntimeDetail = null; // status codes only; never bodies, keys or capability
      try {
        if (!pinnedIdentity || !pinnedPublication || result.packageDir !== path.resolve(packageDir)) {
          throw new Error("pinned_runtime_unavailable");
        }
        const slug = probe.slug ?? DEFAULT_PINNED_PROBE.slug;
        const productPath = `/catalog/category/${probe.categorySlug ?? DEFAULT_PINNED_PROBE.categorySlug}/${slug}`;
        const checked = await verifyPackagedWorker({
          packageDir: result.packageDir,
          supabaseUrl: resolved.url,
          publishableKey: resolved.key,
          publicationId: pinnedIdentity.releaseId,
          publicationCapability: pinnedIdentity.capability,
          publicationSha256: pinnedPublication.publicationSha256,
          searchQuery: probe.query,
          aliasPath: `/product/${probe.slug ?? DEFAULT_PINNED_PROBE.slug}`,
          staticPath: productPath,
          browserProbe: { query: probe.query, expectedName: probe.expectedName, expectedSlug: slug, productPath },
        });
        pinnedRuntimeOk = checked.health.status === 200
          && checked.search.status === 200 && checked.search.slug === slug
          && checked.alias.status === 308
          && checked.alias.location === productPath
          && checked.static.status === 200
          && checked.static.contentType?.startsWith("text/html") === true;
        pinnedRuntimeDetail = { health: checked.health.status, search: checked.search.status,
          searchSlugMatches: checked.search.slug === slug, alias: checked.alias.status,
          aliasLocationMatches: checked.alias.location === productPath, static: checked.static.status };
        pinnedBrowserOk = checked.browser?.ok === true;
        pinnedBrowserStage = checked.browser?.ok === false ? checked.browser.stage ?? "unknown" : null;
        pinnedBrowserReason = checked.browser?.ok === false ? checked.browser.reason ?? "other" : null;
      } catch (error) {
        pinnedRuntimeOk = false;
        pinnedRuntimeDetail = { error: String(error?.message ?? error).replace(/[^A-Za-z0-9_ :.-]/g, "").slice(0, 80) };
      }
      outcome = pinnedRuntimeOk && pinnedBrowserOk
        ? { ...outcome, pinnedRuntimeOk: true, pinnedBrowserOk: true }
        : { ...outcome, ok: false, code: pinnedRuntimeOk ? "pinned_browser_failed" : "pinned_runtime_failed",
          stage: "runtime", pinnedRuntimeOk, pinnedBrowserOk, pinnedBrowserStage, pinnedBrowserReason,
          pinnedRuntimeDetail };
      if (outcome.ok) {
        const finalCheck = await verifyPinnedCandidateFinalState({
          expectedRevision: initialRevision,
          readRevision: () => readPublicContentRevision({ url: resolved.url, key: resolved.key }),
          verifySealedSource: () => sealedSourceMatches(initialRevision),
          verifyPackage: () => verifyPackageIntegrity(result.packageDir).ok,
        });
        if (!finalCheck.ok) outcome = { ...outcome, ok: false, code: finalCheck.code, stage: "after_runtime" };
      }
    }
    const pinned = pinnedFlow && outcome.ok && pinnedIdentity && pinnedPublication
      ? { releaseId: pinnedIdentity.releaseId, capability: pinnedIdentity.capability,
        publicationSha256: pinnedPublication.publicationSha256, revision: initialRevision }
      : null;
    return { outcome, pinned };
  }

  try {
    const { outcome, pinned } = await main();
    print(outcome);
    return { outcome, pinned };
  } catch {
    const outcome = { kind, ok: false, code: "workers_build_failed", stage: "preflight", stagingDir: null,
      packageDir: null, productionReady: false, externalPublication: false, publishedPackageUnchanged: true };
    print(outcome);
    return { outcome, pinned: null };
  }
}
