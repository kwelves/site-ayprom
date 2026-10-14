import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { derivePublicRoutes } from "../derive-routes";
import { validateCatalogSnapshot } from "../snapshot";
import { runStaticProducer } from "./run";
import type { StaticProducerResult } from "./types";

// Fixture-mode CLI: crawls the checked-in synthetic catalog snapshot through the
// loopback fixture server into dist/staging. No Next, Supabase or env file is
// involved; wiring a real `next start` child is the next integration step.

const REPO_RELATIVE_ROOT = new URL("../../../../", import.meta.url);
const DEFAULT_SNAPSHOT = fileURLToPath(new URL("fixtures/cloudflare-static-producer/catalog-snapshot.json", REPO_RELATIVE_ROOT));
const FIXTURE_SERVER = fileURLToPath(new URL("scripts/cloudflare/static-producer-fixture-server.mjs", REPO_RELATIVE_ROOT));
const DEFAULT_SITE_URL = "https://www.ayprom-gidravlika.kg";
const DEFAULT_MEDIA_URL = "https://media.ayprom-gidravlika.kg";

export interface FixtureCliOptions {
  repoRoot: string;
  stagingRoot: string;
  snapshotPath: string;
  siteUrl: string;
  gitSha: string | null;
  concurrency: number | null;
  nextStaticDir: string | null;
  publicRepoRoot: string | null;
  serverArgs: string[];
}

export function parseFixtureCliArgs(argv: string[], cwd: string): FixtureCliOptions {
  const options: FixtureCliOptions = {
    repoRoot: cwd,
    stagingRoot: "",
    snapshotPath: DEFAULT_SNAPSHOT,
    siteUrl: DEFAULT_SITE_URL,
    gitSha: null,
    concurrency: null,
    nextStaticDir: null,
    publicRepoRoot: null,
    serverArgs: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    index += 1;
    switch (flag) {
      case "--repo-root": options.repoRoot = path.resolve(cwd, value); break;
      case "--staging-root": options.stagingRoot = path.resolve(cwd, value); break;
      case "--snapshot": options.snapshotPath = path.resolve(cwd, value); break;
      case "--site-url": options.siteUrl = value; break;
      case "--git-sha": options.gitSha = value; break;
      case "--concurrency": options.concurrency = Number(value); break;
      case "--next-static": options.nextStaticDir = path.resolve(cwd, value); break;
      case "--public-repo": options.publicRepoRoot = path.resolve(cwd, value); break;
      case "--server-arg": options.serverArgs.push(value); break;
      default: throw new Error(`unknown flag ${flag}`);
    }
  }
  if (options.stagingRoot === "") options.stagingRoot = path.join(options.repoRoot, "dist", "staging");
  return options;
}

export async function runFixtureCli(
  argv: string[],
  io: { cwd: string; write: (line: string) => void; signal?: AbortSignal },
): Promise<number> {
  const options = parseFixtureCliArgs(argv, io.cwd);
  const snapshot = validateCatalogSnapshot(JSON.parse(await fs.readFile(options.snapshotPath, "utf8")));
  if (!snapshot.ok) {
    io.write(JSON.stringify({ ok: false, code: snapshot.code, issues: snapshot.issues }));
    return 1;
  }
  const gitSha = options.gitSha ?? resolveGitSha(options.repoRoot);
  const { manifestEntries, sitemapEntries, blockers } = derivePublicRoutes(snapshot.value, options.siteUrl);

  const result = await runStaticProducer({
    preflight: {
      sourceMode: "fixture",
      release: false,
      repoRoot: options.repoRoot,
      outputRoot: options.stagingRoot,
      gitSha,
      hasTrackedChanges: true,
      requestedPort: null,
      requestedPortAvailable: true,
      env: {
        AYPROM_STATIC_BUILD: "1",
        NEXT_PUBLIC_SITE_URL: options.siteUrl,
        NEXT_PUBLIC_MEDIA_BASE_URL: DEFAULT_MEDIA_URL,
        NEXT_PUBLIC_HERO_MEDIA_SOURCE: "r2",
      },
    },
    snapshotId: snapshot.value.snapshotId,
    entries: manifestEntries,
    blockers,
    sitemapPaths: sitemapEntries.map((entry) => entry.path),
    server: ({ routeManifestPath, sitemapPathsPath }) => ({
      command: process.execPath,
      args: [FIXTURE_SERVER, "--manifest", routeManifestPath, "--sitemap", sitemapPathsPath, "--site-url", options.siteUrl, ...options.serverArgs],
      cwd: options.repoRoot,
      readyPattern: /Ready on (http:\/\/127\.0\.0\.1:\d+)/,
    }),
    limits: options.concurrency === null ? undefined : { concurrency: options.concurrency },
    nextStaticDir: options.nextStaticDir ?? undefined,
    publicRepoRoot: options.publicRepoRoot ?? undefined,
    signal: io.signal,
  });

  io.write(JSON.stringify(summarize(result)));
  return result.ok ? 0 : 1;
}

function summarize(result: StaticProducerResult) {
  if (result.ok) {
    return {
      ok: true,
      stagingDir: result.stagingDir,
      reportPath: result.reportPath,
      summary: result.report.summary,
      ...(result.report.staticAssets ? { staticFileCount: result.report.staticAssets.fileCount } : {}),
      ...(result.report.publicAssets ? { publicFileCount: result.report.publicAssets.fileCount } : {}),
      cleanup: result.cleanup,
    };
  }
  return {
    ok: false,
    code: result.code,
    reason: result.reason ?? null,
    issues: result.issues ?? [],
    exitCode: result.exitCode ?? null,
    stagingDir: result.stagingDir,
    reportPath: result.reportPath,
    summary: result.report?.summary ?? null,
    cleanup: result.cleanup,
  };
}

function resolveGitSha(repoRoot: string): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  const sha = result.status === 0 ? result.stdout.trim() : "";
  // Preflight rejects a non-hex SHA, so an unresolvable repository fails loudly.
  return sha || "not-a-git-repository";
}
