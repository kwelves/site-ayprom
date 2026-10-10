import { promises as fs } from "node:fs";
import path from "node:path";
import { STATIC_ASSET_MAX_FILE_BYTES, validateArtifactPolicy, type ArtifactCandidate } from "../artifact-policy";
import { validateStaticBuildPreflight } from "../preflight";
import { collectProductAliases, serializeAliasWorkerEntry } from "./alias-worker";
import { serializeSpeculationRules, serializeStaticHeaders, SPECULATION_RULES_FILE } from "./headers";
import { createRouteManifest, routePathToOutputFile, serializeRouteManifest } from "../route-manifest";
import type { StaticBuildIssue } from "../validation";
import { startChildServer } from "./child-server";
import { crawlRoutes } from "./crawl";
import { isProducerError, ProducerError } from "./errors";
import { serializeVerificationReport, verificationIssues, verifyStagedDocuments } from "./html-verification";
import { serializeSitemapVerification, verifySitemapXml } from "./sitemap-verification";
import { linkVerificationReport, serializeLinkVerification, verifyDocumentLinks } from "./link-verification";
import { buildCrawlReport, serializeCrawlReport } from "./report";
import { readReferencedPublicAssets } from "./public-assets";
import { readNextStaticAssets, staticAssetReport, writeNextStaticAssets, type PlannedStaticAsset } from "./static-assets";
import { assertStagingRootAllowed, createStagingDirectory, writeStagingFile } from "./staging";
import type {
  ChildStopResult,
  CrawlReport,
  CrawlResult,
  StaticAssetReport,
  ProducerLimits,
  RunningChildServer,
  StaticProducerFailure,
  StaticProducerInput,
  StaticProducerResult,
} from "./types";

export const DEFAULT_PRODUCER_LIMITS: ProducerLimits = {
  concurrency: 4,
  requestTimeoutMs: 10_000,
  maxBodyBytes: 8 * 1024 * 1024,
  launchTimeoutMs: 30_000,
  totalTimeoutMs: 300_000,
  stopTimeoutMs: 10_000,
  notFoundProbePath: "/ayprom-static-build-not-found-probe",
};
const MAX_CONCURRENCY = 16;

/**
 * Staging-only crawl producer.
 *
 * Order of operations: validate everything that can be validated without side
 * effects (preflight, limits, blockers, manifest, and the optional .next/static
 * tree); create a unique staging directory under dist/; start the child server;
 * crawl into staging/site; copy the already validated static files to
 * staging/site/_next/static; check the artifact policy; write the crawl report;
 * stop the child. The child is always stopped, a cleanup failure never hides
 * the primary failure, and dist/site is never read, written or promoted here.
 * Without nextStaticDir the crawl stays documents-only. The staging tree is
 * not a deployable site.
 *
 * Failure policy: a failed run keeps its staging directory (route manifest,
 * whatever was crawled, crawl report) for diagnostics. Nothing outside that
 * directory is created or removed.
 */
export async function runStaticProducer(input: StaticProducerInput): Promise<StaticProducerResult> {
  const preflight = validateStaticBuildPreflight(input.preflight);
  if (!preflight.ok) return earlyFailure(preflight.code, "preflight_issues", preflight.issues);

  const limits = resolveLimits(input.limits);
  if (!limits.ok) return earlyFailure("preflight_failed", "limit_issues", limits.issues);

  if (input.blockers.length > 0) {
    return earlyFailure(
      "route_manifest_incomplete",
      "unresolved_blockers",
      input.blockers.map((blocker) => ({ field: blocker.path, rule: blocker.reason })),
    );
  }
  const invalidEntries = input.entries.filter((entry) => entry.class === "invalid");
  if (invalidEntries.length > 0) {
    return earlyFailure(
      "route_manifest_incomplete",
      "invalid_entries",
      invalidEntries.map((entry) => ({ field: entry.path, rule: entry.class === "invalid" ? entry.reason : "invalid" })),
    );
  }
  const manifest = createRouteManifest(input.snapshotId, input.entries);
  if (!manifest.ok) return earlyFailure(manifest.code, "manifest_issues", manifest.issues);
  let productAliases;
  try {
    productAliases = collectProductAliases(manifest.value.entries);
  } catch (error) {
    if (!isProducerError(error)) throw error;
    return earlyFailure(error.code, error.reason, error.issues);
  }
  let staticHeaders: string;
  try {
    staticHeaders = serializeStaticHeaders({
      siteOrigin: preflight.value.siteOrigin,
      mediaOrigin: preflight.value.mediaOrigin,
      browserSupabaseUrl: input.preflight.env.NEXT_PUBLIC_SUPABASE_URL,
    });
  } catch (error) {
    if (!isProducerError(error)) throw error;
    return earlyFailure(error.code, error.reason, error.issues);
  }
  const headersCandidate: ArtifactCandidate = {
    path: "_headers", size: Buffer.byteLength(staticHeaders), text: staticHeaders,
  };
  const headerPolicy = validateArtifactPolicy([headersCandidate]);
  if (!headerPolicy.ok) return earlyFailure(headerPolicy.code, "static_header_policy_failed", headerPolicy.issues);
  if (input.sitemapPaths === undefined) {
    return earlyFailure("sitemap_verification_failed", "sitemap_paths_missing", [
      { field: "sitemapPaths", rule: "required" },
    ]);
  }

  let plannedStatic: PlannedStaticAsset[] | null = null;
  if (input.nextStaticDir !== undefined) {
    try {
      const reserved = manifest.value.entries.flatMap((entry) =>
        entry.class === "static" || entry.class === "query" ? [entry.outputFile] : []);
      plannedStatic = await readNextStaticAssets(input.nextStaticDir, reserved);
    } catch (error) {
      if (!isProducerError(error)) throw error;
      return earlyFailure(error.code, error.reason, error.issues);
    }
  }

  try {
    await assertStagingRootAllowed(preflight.value.repoRoot, preflight.value.outputRoot);
  } catch (error) {
    if (!isProducerError(error)) throw error;
    return earlyFailure(error.code, error.reason, error.issues);
  }

  const staging = await createStagingDirectory(preflight.value.outputRoot);
  try {
    // The root can be replaced by a junction after the check above. Re-check
    // before writing the manifest or starting the child. This still cannot
    // promise that nothing was created if the swap happens during mkdir.
    await assertStagingRootAllowed(preflight.value.repoRoot, staging.stagingDir);
  } catch (error) {
    if (!isProducerError(error)) throw error;
    return {
      ...earlyFailure(error.code, error.reason, error.issues),
      stagingDir: staging.stagingDir,
    };
  }
  const routeManifestPath = path.join(staging.metaDir, "route-manifest.json");
  const sitemapPathsPath = path.join(staging.metaDir, "expected-sitemap-paths.json");
  await fs.writeFile(routeManifestPath, serializeRouteManifest(manifest.value), { flag: "wx" });
  await fs.writeFile(sitemapPathsPath, `${JSON.stringify(input.sitemapPaths)}\n`, { flag: "wx" });
  const relativeToMeta = (sourcePath: string) => path.relative(staging.metaDir, sourcePath).replaceAll("\\", "/");
  await fs.writeFile(path.join(staging.metaDir, "alias-worker-entry.mjs"), serializeAliasWorkerEntry(
    productAliases,
    relativeToMeta(path.join(preflight.value.repoRoot, "src/cloudflare/worker.ts")),
    relativeToMeta(path.join(preflight.value.repoRoot, "src/cloudflare/product-alias-redirects.ts")),
  ), { flag: "wx" });

  const signals = [AbortSignal.timeout(limits.value.totalTimeoutMs)];
  if (input.signal) signals.push(input.signal);
  const signal = AbortSignal.any(signals);
  const startServer = input.startServer ?? startChildServer;
  const spec = typeof input.server === "function"
    ? input.server({ stagingDir: staging.stagingDir, routeManifestPath, sitemapPathsPath })
    : input.server;

  let server: RunningChildServer | null = null;
  let crawl: CrawlResult | null = null;
  let primary: ProducerError | null = null;
  let cleanup: ChildStopResult | null = null;
  try {
    server = await startServer(spec, { launchTimeoutMs: limits.value.launchTimeoutMs, signal });
    crawl = { entries: [], failures: [] };
    crawl = await crawlRoutes({
      baseUrl: server.baseUrl,
      entries: manifest.value.entries,
      limits: limits.value,
      signal,
      sink: { write: async (outputFile, bytes) => { await writeStagingFile(staging.siteDir, outputFile, bytes); } },
    });
  } catch (error) {
    primary = toProducerError(error, server === null ? "next_start_failed" : "crawl_failed");
    if (primary.partial) crawl = primary.partial;
  } finally {
    if (server) cleanup = await server.stop({ timeoutMs: limits.value.stopTimeoutMs });
  }

  let copiedStatic: StaticAssetReport | undefined;
  let copiedPublic: StaticAssetReport | undefined;
  let plannedPublicAssets: PlannedStaticAsset[] | null = null;
  if (!primary && crawl && plannedStatic) {
    try {
      await writeNextStaticAssets(staging.siteDir, plannedStatic);
      copiedStatic = staticAssetReport(plannedStatic);
    } catch (error) {
      primary = toProducerError(error, "crawl_failed");
    }
  }

  if (!primary && crawl && input.publicRepoRoot !== undefined) {
    try {
      const reserved = [
        "_headers",
        ...crawl.entries.map((entry) => entry.outputFile),
        ...(plannedStatic ?? []).map((asset) => asset.outputFile),
      ];
      const plannedPublic = plannedPublicAssets = await readReferencedPublicAssets({
        siteDir: staging.siteDir,
        metaDir: staging.metaDir,
        publicDir: path.join(input.publicRepoRoot, "public"),
        repoRoot: input.publicRepoRoot,
        siteOrigin: preflight.value.siteOrigin,
        routePaths: manifest.value.entries.map((entry) => entry.path),
        reservedOutputFiles: reserved,
      });
      await writeNextStaticAssets(staging.siteDir, plannedPublic);
      copiedPublic = staticAssetReport(plannedPublic);
    } catch (error) {
      primary = toProducerError(error, "artifact_policy_failed");
    }
  }

  if (!primary && crawl) {
    const documents = await Promise.all(crawl.entries.map(async (entry) => ({
      path: entry.outputFile,
      size: entry.bytes,
      text: await fs.readFile(path.join(staging.siteDir, entry.outputFile), "utf8"),
    })));
    const policy = validateArtifactPolicy([
      ...combineArtifactCandidates(documents, plannedStatic, plannedPublicAssets),
      headersCandidate,
    ]);
    if (!policy.ok) primary = new ProducerError(policy.code, "artifact_policy_issues", { issues: policy.issues });
  }

  if (!primary && crawl) {
    try {
      await writeStagingFile(staging.siteDir, "_headers", Buffer.from(staticHeaders));
      await writeStagingFile(staging.siteDir, SPECULATION_RULES_FILE, Buffer.from(serializeSpeculationRules()));
    } catch (error) {
      primary = toProducerError(error, "artifact_policy_failed");
    }
  }

  if (!primary && crawl && crawl.failures.length === 0) {
    const verification = await verifyStagedDocuments(staging.siteDir, manifest.value.entries);
    await fs.writeFile(
      path.join(staging.metaDir, "verification-report.json"),
      serializeVerificationReport(verification),
      { flag: "wx" },
    );
    if (!verification.ok) {
      primary = new ProducerError("seo_verification_failed", "html_verification_failed", {
        issues: verificationIssues(verification),
      });
    }
  }

  if (!primary && crawl && crawl.failures.length === 0 && input.sitemapPaths) {
    let xml = "";
    try {
      xml = await fs.readFile(path.join(staging.siteDir, "sitemap.xml"), "utf8");
    } catch {
      xml = "";
    }
    const aliasPaths = manifest.value.entries.flatMap((entry) =>
      entry.class === "redirect" && entry.family === "product-alias" ? [entry.path] : []);
    const sitemapReport = xml === ""
      ? { schemaVersion: 1 as const, ok: false, expected: input.sitemapPaths.length, found: 0, failures: [{ url: "", rule: "sitemap_missing" as const }] }
      : verifySitemapXml(xml, input.sitemapPaths, preflight.value.siteOrigin, aliasPaths);
    await fs.writeFile(
      path.join(staging.metaDir, "sitemap-verification.json"),
      serializeSitemapVerification(sitemapReport),
      { flag: "wx" },
    );
    if (!sitemapReport.ok) {
      primary = new ProducerError("sitemap_verification_failed", "sitemap_mismatch", {
        issues: sitemapReport.failures.map((failure) => ({ field: failure.rule, rule: failure.rule })),
      });
    }
  }

  if (!primary && crawl && crawl.failures.length === 0) {
    const pages = new Map<string, string>();
    for (const entry of manifest.value.entries) {
      if ((entry.class !== "static" && entry.class !== "query") || entry.family === "robots" || entry.family === "sitemap") continue;
      pages.set(entry.path, await fs.readFile(path.join(staging.siteDir, entry.outputFile), "utf8"));
    }
    const files = new Set<string>();
    const walkFiles = async (directory: string, prefix: string) => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const child = prefix === "" ? `/${entry.name}` : `${prefix}/${entry.name}`;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await walkFiles(path.join(directory, entry.name), child);
        else files.add(child.endsWith(".html") ? child.slice(0, -".html".length) || "/" : child);
      }
    };
    await walkFiles(staging.siteDir, "");
    const aliases = new Set(manifest.value.entries.flatMap((entry) =>
      entry.class === "redirect" && entry.family === "product-alias" ? [entry.path] : []));
    const links = [...pages].flatMap(([from, html]) => verifyDocumentLinks({
      html, from, siteOrigin: preflight.value.siteOrigin, pages, files, aliases,
    }));
    const linkReport = linkVerificationReport(links);
    await fs.writeFile(path.join(staging.metaDir, "link-verification.json"), serializeLinkVerification(linkReport), { flag: "wx" });
    if (!linkReport.ok) {
      primary = new ProducerError("link_verification_failed", "broken_internal_link", {
        issues: linkReport.links.filter((link) => link.status === "broken").map((link) => ({
          field: link.from, rule: link.rule ?? "missing_target",
        })),
      });
    }
  }

  let report: CrawlReport | null = null;
  let reportPath: string | null = null;
  if (crawl) {
    report = buildCrawlReport({
      snapshotId: input.snapshotId,
      gitSha: preflight.value.gitSha,
      sourceMode: preflight.value.sourceMode,
      entries: manifest.value.entries,
      crawl,
      staticAssets: copiedStatic,
      publicAssets: copiedPublic,
    });
    reportPath = path.join(staging.metaDir, "crawl-report.json");
    await fs.writeFile(reportPath, serializeCrawlReport(report), { flag: "wx" });
  }

  const context = {
    stagingDir: staging.stagingDir,
    reportPath,
    report,
    childPid: server?.pid ?? primary?.childPid ?? null,
    cleanup,
  };
  if (primary) {
    return {
      ok: false,
      code: primary.code,
      reason: primary.reason,
      issues: primary.issues,
      exitCode: primary.exitCode,
      ...context,
    };
  }
  if (report && report.failures.length > 0) {
    return { ok: false, code: "crawl_failed", reason: "route_failures", ...context };
  }
  if (cleanup && !cleanup.ok) {
    return { ok: false, code: "cleanup_failed", reason: cleanup.reason, ...context };
  }
  return {
    ok: true,
    stagingDir: staging.stagingDir,
    siteDir: staging.siteDir,
    reportPath: reportPath!,
    report: report!,
    childPid: server!.pid,
    cleanup: cleanup!,
  };
}

function earlyFailure(
  code: StaticProducerFailure["code"],
  reason: string,
  issues: StaticBuildIssue[],
): StaticProducerFailure {
  return { ok: false, code, reason, issues, stagingDir: null, reportPath: null, report: null, childPid: null, cleanup: null };
}

function toProducerError(
  error: unknown,
  fallbackCode: "next_start_failed" | "crawl_failed" | "artifact_policy_failed",
): ProducerError {
  if (isProducerError(error)) return error;
  return new ProducerError(fallbackCode, "unexpected_error", {
    issues: [{ field: "error", rule: error instanceof Error ? error.name : "unknown" }],
  });
}

function resolveLimits(
  overrides: Partial<ProducerLimits> | undefined,
): { ok: true; value: ProducerLimits } | { ok: false; issues: StaticBuildIssue[] } {
  const value: ProducerLimits = { ...DEFAULT_PRODUCER_LIMITS };
  for (const [key, override] of Object.entries(overrides ?? {})) {
    if (override !== undefined) (value as unknown as Record<string, unknown>)[key] = override;
  }
  const issues: StaticBuildIssue[] = [];
  const positiveInteger = (field: keyof ProducerLimits, max = Number.MAX_SAFE_INTEGER) => {
    const candidate = value[field];
    if (!Number.isInteger(candidate) || (candidate as number) < 1 || (candidate as number) > max) {
      issues.push({ field: `limits.${field}`, rule: "out_of_range" });
    }
  };
  positiveInteger("concurrency", MAX_CONCURRENCY);
  positiveInteger("requestTimeoutMs");
  positiveInteger("maxBodyBytes", STATIC_ASSET_MAX_FILE_BYTES);
  positiveInteger("launchTimeoutMs");
  positiveInteger("totalTimeoutMs");
  positiveInteger("stopTimeoutMs");
  try {
    routePathToOutputFile(value.notFoundProbePath);
  } catch {
    issues.push({ field: "limits.notFoundProbePath", rule: "invalid_path" });
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value };
}

export function combineArtifactCandidates(
  documents: readonly ArtifactCandidate[],
  staticAssets: readonly PlannedStaticAsset[] | null,
  publicAssets: readonly PlannedStaticAsset[] | null,
): ArtifactCandidate[] {
  return [
    ...documents,
    ...stagedAssetCandidates(staticAssets),
    ...stagedAssetCandidates(publicAssets),
  ];
}

function stagedAssetCandidates(assets: readonly PlannedStaticAsset[] | null): ArtifactCandidate[] {
  return (assets ?? []).map((asset) => ({
    path: asset.outputFile,
    size: asset.bytes.byteLength,
    text: textExtension(asset.outputFile) ? Buffer.from(asset.bytes).toString("utf8") : undefined,
  }));
}

function textExtension(outputFile: string): boolean {
  const extension = outputFile.slice(outputFile.lastIndexOf(".")).toLowerCase();
  return extension === ".js" || extension === ".mjs" || extension === ".cjs" || extension === ".css"
    || extension === ".json" || extension === ".txt";
}
