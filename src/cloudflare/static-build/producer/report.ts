import type { RouteManifestEntry } from "../route-manifest";
import type { CrawlReport, CrawlResult, PendingAlias, StaticAssetReport } from "./types";

// The report carries no timestamps, base URL, port or PID: identical crawl
// results serialize byte-identically regardless of when or where they ran.
export function buildCrawlReport(input: {
  snapshotId: string;
  gitSha: string;
  sourceMode: CrawlReport["sourceMode"];
  entries: RouteManifestEntry[];
  crawl: CrawlResult;
  staticAssets?: StaticAssetReport;
  publicAssets?: StaticAssetReport;
}): CrawlReport {
  const documents = input.entries.filter((entry) => entry.class === "static" || entry.class === "query");
  const pendingAliases: PendingAlias[] = input.entries
    .flatMap((entry) => (entry.class === "redirect"
      ? [{ path: entry.path, redirectTo: entry.redirectTo, status: entry.status }]
      : []))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  return {
    schemaVersion: 1,
    snapshotId: input.snapshotId,
    gitSha: input.gitSha,
    sourceMode: input.sourceMode,
    summary: {
      routes: documents.length,
      written: input.crawl.entries.length,
      failed: input.crawl.failures.length,
      pendingAliases: pendingAliases.length,
    },
    entries: input.crawl.entries,
    failures: input.crawl.failures,
    pendingAliases,
    ...(input.staticAssets === undefined ? {} : { staticAssets: input.staticAssets }),
    ...(input.publicAssets === undefined ? {} : { publicAssets: input.publicAssets }),
  };
}

export function serializeCrawlReport(report: CrawlReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
