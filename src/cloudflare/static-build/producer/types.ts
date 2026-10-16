// Node-only static producer contracts. Nothing here may be imported by the
// Worker or by public runtime code: the producer drives a child process and
// writes to the filesystem.
//
// Imports inside this directory use relative paths without extensions and
// only erasable TypeScript syntax, so the CLI can load these modules through
// Node's built-in type stripping without a bundler.
import type { StaticBuildPreflightInput, StaticBuildSourceMode } from "../preflight";
import type { RouteManifestEntry } from "../route-manifest";
import type { StaticBuildFailureCode, StaticBuildIssue } from "../validation";

export type ProducerFailureCode =
  | StaticBuildFailureCode
  | "next_start_failed"
  | "crawl_failed"
  | "cleanup_failed"
  | "seo_verification_failed"
  | "sitemap_verification_failed"
  | "link_verification_failed";

export interface ChildServerSpec {
  /** Executable path. Spawned with `shell: false`, so no interpolation happens. */
  command: string;
  args: string[];
  cwd: string;
  /**
   * Explicit environment for the child. Only these keys plus a small allowlist
   * needed by Node itself on the host platform are passed; the producer's own
   * process environment is never inherited wholesale.
   */
  env?: Record<string, string>;
  /** Matched against stdout lines; capture group 1 must be the loopback base URL. */
  readyPattern: RegExp;
  /** Path polled for HTTP 200 once the URL is known. Defaults to "/". */
  readyProbePath?: string;
}

export interface ChildServerContext {
  stagingDir: string;
  routeManifestPath: string;
  sitemapPathsPath: string;
}

export interface ProducerLimits {
  /** Parallel HTTP requests during the crawl, 1..16. */
  concurrency: number;
  requestTimeoutMs: number;
  maxBodyBytes: number;
  launchTimeoutMs: number;
  totalTimeoutMs: number;
  stopTimeoutMs: number;
  /** Intentionally unknown URL used to capture the real 404 document. */
  notFoundProbePath: string;
}

export type ChildStopResult =
  | { ok: true; exitCode: number | null; signal: string | null; alreadyExited: boolean }
  | { ok: false; reason: "child_stop_timeout" | "kill_failed" };

export interface RunningChildServer {
  baseUrl: string;
  pid: number;
  stop(options: { timeoutMs: number }): Promise<ChildStopResult>;
}

export interface StartChildServerOptions {
  launchTimeoutMs: number;
  signal?: AbortSignal;
}

export type StartChildServer = (
  spec: ChildServerSpec,
  options: StartChildServerOptions,
) => Promise<RunningChildServer>;

export interface StaticProducerInput {
  preflight: StaticBuildPreflightInput;
  snapshotId: string;
  entries: RouteManifestEntry[];
  /** Blockers reported by route derivation. Any blocker makes the manifest incomplete. */
  blockers: { path: string; reason: string }[];
  server: ChildServerSpec | ((context: ChildServerContext) => ChildServerSpec);
  limits?: Partial<ProducerLimits>;
  signal?: AbortSignal;
  /**
   * Real directory whose contents are copied to `staging/site/_next/static`.
   * Omitted in the HTML-only fixture mode. This is the `.next/static` tree,
   * not the whole `.next` directory.
   */
  nextStaticDir?: string;
  /**
   * Git repository whose tracked `public/` files may be copied when emitted
   * HTML, CSS, or metadata references them. Omitted keeps the HTML-only fixture.
   */
  publicRepoRoot?: string;
  /** Paths from derivePublicRoutes sitemapEntries. Omitted skips the sitemap gate. */
  sitemapPaths?: string[];
  /** The pages are built with the Cloudflare Web Analytics script, so the headers must let it run. */
  webAnalytics?: boolean;
  /** Test seam; defaults to the real child-process starter. */
  startServer?: StartChildServer;
}

export type CrawlFailureReason =
  | "unexpected_status"
  | "unexpected_redirect"
  | "unexpected_content_type"
  | "body_limit_exceeded"
  | "request_timeout"
  | "request_failed";

export interface CrawlReportEntry {
  path: string;
  family: RouteManifestEntry["family"];
  class: "static" | "query";
  outputFile: string;
  status: number;
  /** Media type without parameters, e.g. "text/html". */
  contentType: string;
  bytes: number;
  sha256: string;
}

export interface CrawlFailure {
  path: string;
  outputFile: string;
  reason: CrawlFailureReason;
  status?: number;
  /** Node/undici error code such as ECONNREFUSED. Never the message. */
  errorCode?: string;
}

export interface PendingAlias {
  path: string;
  redirectTo: string;
  status: 308;
}

export interface CrawlReport {
  schemaVersion: 1;
  snapshotId: string;
  gitSha: string;
  sourceMode: Exclude<StaticBuildSourceMode, "revisioned-live">;
  summary: { routes: number; written: number; failed: number; pendingAliases: number };
  entries: CrawlReportEntry[];
  failures: CrawlFailure[];
  /** Product aliases reserved for the future thin-Worker redirect slice. */
  pendingAliases: PendingAlias[];
  /** Present only when the run was given a `.next/static` directory. */
  staticAssets?: StaticAssetReport;
  /** Present only when the run was given a public Git repository. */
  publicAssets?: StaticAssetReport;
}

export interface StaticAssetReport {
  fileCount: number;
  totalBytes: number;
  files: { path: string; bytes: number; sha256: string }[];
}

export interface CrawlSink {
  write(outputFile: string, bytes: Uint8Array): Promise<void>;
}

export interface CrawlResult {
  entries: CrawlReportEntry[];
  failures: CrawlFailure[];
}

export interface StaticProducerSuccess {
  ok: true;
  stagingDir: string;
  siteDir: string;
  reportPath: string;
  report: CrawlReport;
  childPid: number;
  cleanup: ChildStopResult;
}

export interface StaticProducerFailure {
  ok: false;
  code: ProducerFailureCode;
  reason?: string;
  issues?: StaticBuildIssue[];
  exitCode?: number | null;
  stagingDir: string | null;
  reportPath: string | null;
  report: CrawlReport | null;
  childPid: number | null;
  cleanup: ChildStopResult | null;
}

export type StaticProducerResult = StaticProducerSuccess | StaticProducerFailure;
