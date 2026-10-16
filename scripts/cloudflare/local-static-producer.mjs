// Diagnostic full-route crawl against the already running LOCAL Supabase and a
// prebuilt AYPROM_STATIC_BUILD=1 Next tree. Writes only ignored dist/staging.
// Never deploys, promotes dist/site, starts a database, or uses service role.
import { register } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
register("./static-producer-loader.mjs", { parentURL: import.meta.url, data: { srcRoot: path.join(repo, "src") } });
const load = (name) => import(pathToFileURL(path.join(repo, "src/cloudflare/static-build", name)).href);
const { localProbeBindings } = await load("local-browser-probe.ts");
const { loadLocalCatalogSnapshot } = await load("producer/local-snapshot.ts");
const { catalogSnapshotFromPublication } = await load("producer/catalog-publication-route-snapshot.ts");
const { loadCatalogPublicationFile } = await import(pathToFileURL(path.join(repo, "src/lib/catalog-publication-file.ts")).href);
const { webAnalyticsToken } = await import(pathToFileURL(path.join(repo, "src/lib/web-analytics.ts")).href);
const { parseWorkersBuildAllowlist, resolveWorkersBuildBinding } = await load("producer/workers-build-config.ts");
const { derivePublicRoutes } = await load("derive-routes.ts");
const { runStaticProducer } = await load("producer/run.ts");

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port; // A later port race remains possible; readiness fails safely.
}

try {
  const buildMode = process.env.AYPROM_WORKERS_BUILD_MODE === "workers-build";
  const pinned = process.env.AYPROM_PUBLIC_CATALOG_READ_MODE === "pinned";
  const pinnedEnv = pinned ? {
    AYPROM_PUBLIC_CATALOG_READ_MODE: "pinned",
    AYPROM_PUBLIC_CATALOG_EXPORT_PATH: process.env.AYPROM_PUBLIC_CATALOG_EXPORT_PATH ?? "",
    AYPROM_PUBLIC_CATALOG_EXPORT_SHA256: process.env.AYPROM_PUBLIC_CATALOG_EXPORT_SHA256 ?? "",
    AYPROM_PUBLIC_CATALOG_RELEASE_ID: process.env.AYPROM_PUBLIC_CATALOG_RELEASE_ID ?? "",
  } : {};
  const bindings = buildMode
    ? workersBuildBindings()
    : localProbeBindings(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    );
  await fs.access(path.join(repo, ".next/BUILD_ID"));
  await fs.access(path.join(repo, ".next/static"));
  const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8", windowsHide: true });
  if (git.status !== 0 || !/^[0-9a-f]{40}$/.test(git.stdout.trim())) throw new Error("git_head_unavailable");
  const snapshot = pinned
    ? catalogSnapshotFromPublication(await loadCatalogPublicationFile({ repoRoot: repo,
      path: pinnedEnv.AYPROM_PUBLIC_CATALOG_EXPORT_PATH,
      sha256: pinnedEnv.AYPROM_PUBLIC_CATALOG_EXPORT_SHA256,
      releaseId: pinnedEnv.AYPROM_PUBLIC_CATALOG_RELEASE_ID }))
    : await loadLocalCatalogSnapshot({
      url: bindings.SUPABASE_URL,
      key: bindings.SUPABASE_PUBLISHABLE_KEY,
      ...(buildMode ? {
        acceptance: "workers-build",
        allowlist: parseWorkersBuildAllowlist(process.env.AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST),
      } : {}),
    });
  const siteUrl = "https://www.ayprom-gidravlika.kg";
  const mediaUrl = "https://media.ayprom-gidravlika.kg";
  // Deliberately unusable browser bindings: this is a diagnostic artifact, not
  // an admin-ready release. Public catalog data is fetched separately below.
  const browserSupabaseUrl = "https://static-build.invalid";
  const browserSupabaseKey = "sb_publishable_diagnostic_only";
  const routes = derivePublicRoutes(snapshot, siteUrl);
  const port = await availablePort();
  const result = await runStaticProducer({
    preflight: {
      sourceMode: "local-snapshot",
      release: false,
      repoRoot: repo,
      outputRoot: path.join(repo, "dist/staging"),
      gitSha: git.stdout.trim(),
      hasTrackedChanges: true,
      requestedPort: port,
      requestedPortAvailable: true,
      env: {
        AYPROM_STATIC_BUILD: "1",
        NEXT_PUBLIC_SITE_URL: siteUrl,
        NEXT_PUBLIC_MEDIA_BASE_URL: mediaUrl,
        NEXT_PUBLIC_HERO_MEDIA_SOURCE: "r2",
        NEXT_PUBLIC_SUPABASE_URL: browserSupabaseUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: browserSupabaseKey,
        AYPROM_STATIC_BUILD_SUPABASE_URL: bindings.SUPABASE_URL,
        AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY: bindings.SUPABASE_PUBLISHABLE_KEY,
        ...pinnedEnv,
        ...(buildMode ? {
          AYPROM_WORKERS_BUILD_MODE: "workers-build",
          AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST: process.env.AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST ?? "",
        } : {}),
      },
    },
    snapshotId: snapshot.snapshotId,
    entries: routes.manifestEntries,
    blockers: routes.blockers,
    sitemapPaths: routes.sitemapEntries.map((entry) => entry.path),
    // The pages were built with the Cloudflare Web Analytics script when the build had a valid token: let it run.
    webAnalytics: webAnalyticsToken(process.env.NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN) !== null,
    nextStaticDir: path.join(repo, ".next/static"),
    publicRepoRoot: repo,
    server: {
      command: process.execPath,
      args: [path.join(repo, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)],
      cwd: repo,
      env: {
        AYPROM_STATIC_BUILD: "1",
        NEXT_PUBLIC_SUPABASE_URL: browserSupabaseUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: browserSupabaseKey,
        AYPROM_STATIC_BUILD_SUPABASE_URL: bindings.SUPABASE_URL,
        AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY: bindings.SUPABASE_PUBLISHABLE_KEY,
        ...pinnedEnv,
        ...(buildMode ? {
          AYPROM_WORKERS_BUILD_MODE: "workers-build",
          AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST: process.env.AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST ?? "",
        } : {}),
        NEXT_PUBLIC_HERO_MEDIA_SOURCE: "r2",
        NEXT_PUBLIC_MEDIA_BASE_URL: mediaUrl,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      readyPattern: /Local:\s+(http:\/\/127\.0\.0\.1:\d+)/,
    },
    limits: { totalTimeoutMs: 600_000, requestTimeoutMs: 20_000 },
  });
  process.stdout.write(`${JSON.stringify({
    kind: "local-full-crawl",
    release: false,
    ok: result.ok,
    code: result.ok ? null : result.code,
    reason: result.ok ? null : result.reason,
    issueCount: result.ok ? 0 : result.issues?.length ?? 0,
    issueRules: result.ok ? {} : Object.fromEntries(
      [...new Set((result.issues ?? []).map((issue) => issue.rule))].sort().map((rule) => [
        rule, (result.issues ?? []).filter((issue) => issue.rule === rule).length,
      ]),
    ),
    summary: result.report?.summary ?? null,
    stagingDir: result.stagingDir,
    cleanup: result.cleanup,
  })}\n`);
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ kind: "local-full-crawl", ok: false, error: error instanceof Error ? error.message.split(":")[0] : "unknown_error" })}\n`);
  process.exitCode = 1;
}

function workersBuildBindings() {
  const resolved = resolveWorkersBuildBinding({
    mode: "workers-build",
    supabaseUrl: process.env.AYPROM_STATIC_BUILD_SUPABASE_URL ?? "",
    publishableKey: process.env.AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY ?? "",
    allowlist: parseWorkersBuildAllowlist(process.env.AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST),
  });
  if (!resolved.ok) throw new Error(resolved.code);
  return { SUPABASE_URL: resolved.url, SUPABASE_PUBLISHABLE_KEY: resolved.key };
}
