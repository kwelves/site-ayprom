import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runStaticProducer } from "@/cloudflare/static-build/producer/run";
import type { CrawlReport, RunningChildServer, StaticProducerInput } from "@/cloudflare/static-build/producer/types";
import type { RouteManifestEntry } from "@/cloudflare/static-build/route-manifest";
import {
  fixtureProducerInput,
  fixtureRoutes,
  listStagingDirs,
  makeTempRepo,
  removeTempRepo,
  sha256,
  SITE_URL,
  snapshotTree,
} from "./cloudflare-static-producer-support";

let repo: ReturnType<typeof makeTempRepo>;
let previousSite: Record<string, string>;

beforeEach(() => {
  repo = makeTempRepo();
  previousSite = repo.siteSnapshot();
});
afterEach(() => {
  removeTempRepo(repo.repoRoot);
});

function readReport(reportPath: string): CrawlReport {
  return JSON.parse(readFileSync(reportPath, "utf8")) as CrawlReport;
}

describe("static producer: validation before side effects", () => {
  it("fails preflight without creating a staging directory", async () => {
    const input = fixtureProducerInput(repo);
    input.preflight.env.AYPROM_STATIC_BUILD = undefined;
    const result = await runStaticProducer(input);
    expect(result).toMatchObject({ ok: false, code: "preflight_failed", stagingDir: null });
    expect(listStagingDirs(repo.stagingRoot)).toEqual([]);
  });

  it("rejects a browser origin that could inject a static header before creating staging", async () => {
    const input = fixtureProducerInput(repo);
    input.preflight.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.com/\nX-Robots-Tag: noindex";
    const result = await runStaticProducer(input);
    expect(result).toMatchObject({
      ok: false,
      code: "preflight_failed",
      issues: [{ field: "NEXT_PUBLIC_SUPABASE_URL", rule: "invalid_origin" }],
      stagingDir: null,
    });
    expect(listStagingDirs(repo.stagingRoot)).toEqual([]);
  });

  it("rejects a staging root outside dist without touching the filesystem", async () => {
    const input = fixtureProducerInput(repo);
    input.preflight.outputRoot = path.join(repo.repoRoot, "elsewhere");
    const result = await runStaticProducer(input);
    expect(result).toMatchObject({
      ok: false,
      code: "preflight_failed",
      issues: expect.arrayContaining([{ field: "outputRoot", rule: "outside_dist" }]),
    });
    expect(existsSync(path.join(repo.repoRoot, "elsewhere"))).toBe(false);
  });

  it("treats invalid manifest entries as route_manifest_incomplete", async () => {
    const input = fixtureProducerInput(repo);
    input.entries = [
      ...input.entries,
      { class: "invalid", family: "product", path: "/product/orphan", reason: "canonical_unresolved", snapshotIds: ["orphan"] },
    ];
    const result = await runStaticProducer(input);
    expect(result).toMatchObject({
      ok: false,
      code: "route_manifest_incomplete",
      issues: [{ field: "/product/orphan", rule: "canonical_unresolved" }],
      stagingDir: null,
    });
    expect(listStagingDirs(repo.stagingRoot)).toEqual([]);
  });

  it("treats unresolved blockers as route_manifest_incomplete", async () => {
    const input = fixtureProducerInput(repo);
    input.blockers = [{ path: "/catalog/category/pumps", reason: "mixed_category_pagination_api_missing" }];
    const result = await runStaticProducer(input);
    expect(result).toMatchObject({
      ok: false,
      code: "route_manifest_incomplete",
      issues: [{ field: "/catalog/category/pumps", rule: "mixed_category_pagination_api_missing" }],
      stagingDir: null,
    });
  });

  it("rejects traversal and case collisions through the route manifest contract", async () => {
    const collision: RouteManifestEntry[] = [
      { class: "static", family: "catalog", path: "/Catalog", outputFile: "Catalog.html", expectedCanonical: `${SITE_URL}/Catalog`, expectedJsonLdTypes: [], expectedIndexable: true, snapshotIds: ["x"] },
      { class: "static", family: "catalog", path: "/catalog", outputFile: "catalog.html", expectedCanonical: `${SITE_URL}/catalog`, expectedJsonLdTypes: [], expectedIndexable: true, snapshotIds: ["x"] },
    ];
    const traversal: RouteManifestEntry[] = [
      { class: "static", family: "catalog", path: "/../escape", outputFile: "../escape.html", expectedCanonical: null, expectedJsonLdTypes: [], expectedIndexable: true, snapshotIds: ["x"] },
    ];
    for (const entries of [collision, traversal]) {
      const result = await runStaticProducer(fixtureProducerInput(repo, { entries, blockers: [] }));
      expect(result).toMatchObject({ ok: false, code: "route_manifest_incomplete", stagingDir: null });
    }
    expect(listStagingDirs(repo.stagingRoot)).toEqual([]);
  });

  it("rejects out-of-range limits before any side effect", async () => {
    const result = await runStaticProducer(fixtureProducerInput(repo, { limits: { concurrency: 0 } }));
    expect(result).toMatchObject({
      ok: false,
      code: "preflight_failed",
      issues: [{ field: "limits.concurrency", rule: "out_of_range" }],
      stagingDir: null,
    });
  });
});

describe("static producer: headers for a build with the analytics script", { timeout: 30_000 }, () => {
  it("lets the Cloudflare Web Analytics script and its report address through the policy, and nothing else wider", async () => {
    const result = await runStaticProducer(fixtureProducerInput(repo, { webAnalytics: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const headers = readFileSync(path.join(result.siteDir, "_headers"), "utf8");
    expect(headers).toContain("script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com");
    expect(headers).toContain("connect-src 'self' https://www.ayprom-gidravlika.kg https://*.sentry.io https://cloudflareinsights.com");
    expect(headers).toContain("img-src 'self' data: blob: https://media.ayprom-gidravlika.kg;");
  });
});

describe("static producer: fixture server crawl into staging", { timeout: 30_000 }, () => {
  it("writes every static/query document with the expected bytes, 404, robots and sitemap", async () => {
    const result = await runStaticProducer(fixtureProducerInput(repo));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { manifestEntries } = fixtureRoutes();
    const documents = manifestEntries.filter((entry) => entry.class === "static" || entry.class === "query");
    const written = snapshotTree(result.siteDir);
    expect(Object.keys(written).sort()).toEqual(
      [...documents.map((entry) => (entry.class === "static" || entry.class === "query" ? entry.outputFile : "")), "_headers", "speculationrules.json"].sort(),
    );
    const headers = readFileSync(path.join(result.siteDir, "_headers"), "utf8");
    expect(headers).toContain("/*\n");
    expect(headers).toContain("  Content-Security-Policy: default-src 'self'");
    expect(headers).toContain("connect-src 'self' https://www.ayprom-gidravlika.kg https://*.sentry.io");
    expect(headers).toContain("img-src 'self' data: blob: https://media.ayprom-gidravlika.kg");
    // The analytics script is allowed only for a build that includes it (see the next test).
    expect(headers).not.toContain("cloudflareinsights.com");
    expect(headers).toContain("  Referrer-Policy: strict-origin-when-cross-origin\n");
    expect(headers).toContain("  X-Content-Type-Options: nosniff\n");
    expect(headers).toContain("  X-Frame-Options: DENY\n");
    expect(headers).toContain("  Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()\n");
    expect(headers).toContain("  Cross-Origin-Opener-Policy: same-origin\n");
    expect(headers).toContain("  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload\n");
    // Instant navigation: Chromium prerenders/prefetches same-origin pages the visitor is about to open.
    expect(headers).toContain('  Speculation-Rules: "/speculationrules.json"\n');
    expect(headers).toContain("/speculationrules.json\n  Content-Type: application/speculationrules+json\n");
    const rules = JSON.parse(readFileSync(path.join(result.siteDir, "speculationrules.json"), "utf8"));
    expect(rules.prerender[0].eagerness).toBe("moderate");
    expect(JSON.stringify(rules)).toContain("/admin/*");
    expect(JSON.stringify(rules)).toContain("/api/*");
    expect(existsSync(path.join(result.stagingDir, "meta", "_headers"))).toBe(false);

    const report = readReport(result.reportPath);
    expect(report.summary).toEqual({
      routes: documents.length,
      written: documents.length,
      failed: 0,
      pendingAliases: 2,
    });
    for (const entry of report.entries) {
      const bytes = readFileSync(path.join(result.siteDir, entry.outputFile));
      expect(bytes.byteLength).toBe(entry.bytes);
      expect(sha256(bytes)).toBe(entry.sha256);
    }
    expect(report.entries.map((entry) => entry.path)).toEqual([...report.entries.map((entry) => entry.path)].sort());

    const byPath = new Map(report.entries.map((entry) => [entry.path, entry]));
    expect(byPath.get("/404")).toMatchObject({ status: 404, contentType: "text/html", outputFile: "404.html" });
    expect(byPath.get("/robots.txt")).toMatchObject({ status: 200, contentType: "text/plain" });
    expect(byPath.get("/sitemap.xml")).toMatchObject({ status: 200, contentType: "application/xml" });
    expect(byPath.get("/catalog/category/pto/brand/kamaz/shaft")).toMatchObject({ status: 200, contentType: "text/html" });
    expect(readFileSync(path.join(result.siteDir, "404.html"), "utf8")).toContain("noindex");
    expect(readFileSync(path.join(result.siteDir, "catalog/category/pto/brand/kamaz/shaft.html"), "utf8"))
      .toContain(`<link rel="canonical" href="${SITE_URL}/catalog/category/pto/brand/kamaz/shaft">`);

    expect(report.pendingAliases).toEqual([
      { path: "/product/seal", redirectTo: "/catalog/category/fittings/seal", status: 308 },
      { path: "/product/shaft", redirectTo: "/catalog/category/pto/brand/kamaz/shaft", status: 308 },
    ]);
    expect(existsSync(path.join(result.siteDir, "product"))).toBe(false);
    expect(existsSync(path.join(result.stagingDir, "meta", "route-manifest.json"))).toBe(true);
    const aliasEntry = path.join(result.stagingDir, "meta", "alias-worker-entry.mjs");
    expect(existsSync(aliasEntry)).toBe(true);
    expect(readFileSync(aliasEntry, "utf8")).toContain('"/product/shaft"');
    expect(existsSync(path.join(result.siteDir, "alias-worker-entry.mjs"))).toBe(false);
    expect(result.cleanup).toMatchObject({ ok: true });
    expect(JSON.stringify(report)).not.toMatch(/127\.0\.0\.1|localhost/);

    expect(repo.siteSnapshot()).toEqual(previousSite);
    expect(listStagingDirs(repo.stagingRoot)).toHaveLength(1);
  });

  it("never reuses a staging directory across runs", async () => {
    const first = await runStaticProducer(fixtureProducerInput(repo));
    const second = await runStaticProducer(fixtureProducerInput(repo));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.stagingDir).not.toBe(second.stagingDir);
    expect(listStagingDirs(repo.stagingRoot)).toHaveLength(2);
  });

  it("reports an unexpected 500 as crawl_failed, keeps staging and leaves dist/site byte-identical", async () => {
    const result = await runStaticProducer(fixtureProducerInput(repo, {}, ["--status", "/catalog=500"]));
    expect(result).toMatchObject({ ok: false, code: "crawl_failed", cleanup: { ok: true } });
    if (result.ok || !result.stagingDir || !result.reportPath) throw new Error("staging expected");
    const report = readReport(result.reportPath);
    expect(report.failures).toEqual([
      { path: "/catalog", outputFile: "catalog.html", reason: "unexpected_status", status: 500 },
    ]);
    expect(report.summary.failed).toBe(1);
    expect(existsSync(path.join(result.stagingDir, "site", "catalog.html"))).toBe(false);
    expect(existsSync(path.join(result.stagingDir, "site", "index.html"))).toBe(true);
    expect(repo.siteSnapshot()).toEqual(previousSite);
  });

  it("does not follow a redirect and records it without the location value", async () => {
    const result = await runStaticProducer(
      fixtureProducerInput(repo, {}, ["--redirect", "/about=https://evil.example/phish"]),
    );
    expect(result).toMatchObject({ ok: false, code: "crawl_failed" });
    if (result.ok || !result.reportPath) throw new Error("report expected");
    const report = readReport(result.reportPath);
    expect(report.failures).toEqual([
      { path: "/about", outputFile: "about.html", reason: "unexpected_redirect", status: 302 },
    ]);
    expect(JSON.stringify(report)).not.toContain("evil.example");
    expect(existsSync(path.join(result.stagingDir!, "site", "about.html"))).toBe(false);
  });

  it("times out a slow response per request without aborting the rest of the crawl", async () => {
    const result = await runStaticProducer(
      fixtureProducerInput(repo, { limits: { requestTimeoutMs: 1_500, launchTimeoutMs: 15_000 } }, ["--delay", "/contacts=8000"]),
    );
    expect(result).toMatchObject({ ok: false, code: "crawl_failed" });
    if (result.ok || !result.reportPath) throw new Error("report expected");
    const report = readReport(result.reportPath);
    expect(report.failures).toEqual([{ path: "/contacts", outputFile: "contacts.html", reason: "request_timeout" }]);
    expect(report.summary.written).toBe(report.summary.routes - 1);
  });

  it("rejects a body above the limit without writing it", async () => {
    const result = await runStaticProducer(
      fixtureProducerInput(repo, { limits: { maxBodyBytes: 2_048 } }, ["--body-bytes", "/catalog=4096"]),
    );
    expect(result).toMatchObject({ ok: false, code: "crawl_failed" });
    if (result.ok || !result.reportPath) throw new Error("report expected");
    expect(readReport(result.reportPath).failures).toEqual([
      { path: "/catalog", outputFile: "catalog.html", reason: "body_limit_exceeded" },
    ]);
    expect(existsSync(path.join(result.stagingDir!, "site", "catalog.html"))).toBe(false);
  });

  it("rejects a document served with the wrong content type", async () => {
    const result = await runStaticProducer(
      fixtureProducerInput(repo, {}, ["--content-type", "/robots.txt=text/html"]),
    );
    expect(result).toMatchObject({ ok: false, code: "crawl_failed" });
    if (result.ok || !result.reportPath) throw new Error("report expected");
    expect(readReport(result.reportPath).failures).toEqual([
      { path: "/robots.txt", outputFile: "robots.txt", reason: "unexpected_content_type", status: 200 },
    ]);
  });

  it("fails artifact policy when a document leaks a loopback origin", async () => {
    const result = await runStaticProducer(
      fixtureProducerInput(repo, { server: ({ routeManifestPath }) => ({
        command: process.execPath,
        args: [
          path.resolve("scripts/cloudflare/static-producer-fixture-server.mjs"),
          "--manifest", routeManifestPath, "--site-url", "http://127.0.0.1:3001",
        ],
        cwd: process.cwd(),
        readyPattern: /Ready on (http:\/\/127\.0\.0\.1:\d+)/,
      }) }),
    );
    expect(result).toMatchObject({ ok: false, code: "artifact_policy_failed", cleanup: { ok: true } });
    if (result.ok) return;
    // The fixture server renders canonicals from the manifest; only robots/sitemap use --site-url.
    expect(result.issues).toEqual(expect.arrayContaining([
      { field: "robots.txt", rule: "forbidden_content" },
      { field: "sitemap.xml", rule: "forbidden_content" },
    ]));
    expect(JSON.stringify(result)).not.toContain("127.0.0.1:3001");
    expect(existsSync(path.join(result.stagingDir!, "site", "robots.txt"))).toBe(true);
  });
});

describe("static producer: child process lifecycle", { timeout: 30_000 }, () => {
  it("reports a launch failure as next_start_failed and keeps staging for diagnostics", async () => {
    const result = await runStaticProducer(fixtureProducerInput(repo, {
      server: { command: path.join(repo.repoRoot, "missing-binary"), args: [], cwd: repo.repoRoot, readyPattern: /Ready on (\S+)/ },
    }));
    expect(result).toMatchObject({ ok: false, code: "next_start_failed", reason: "spawn_failed", report: null });
    expect(result.stagingDir && existsSync(path.join(result.stagingDir, "meta", "route-manifest.json"))).toBe(true);
    expect(repo.siteSnapshot()).toEqual(previousSite);
  });

  it("reports an early child exit with its exit code", async () => {
    const result = await runStaticProducer(fixtureProducerInput(repo, {}, ["--exit-early", "3"]));
    expect(result).toMatchObject({ ok: false, code: "next_start_failed", reason: "child_exited_early", exitCode: 3 });
  });

  it("reports a readiness timeout and stops the child", async () => {
    const result = await runStaticProducer(
      fixtureProducerInput(repo, { limits: { launchTimeoutMs: 700 } }, ["--never-ready"]),
    );
    expect(result).toMatchObject({ ok: false, code: "next_start_failed", reason: "readiness_timeout" });
    if (result.ok) return;
    expect(result.childPid).toEqual(expect.any(Number));
    expect(isProcessAlive(result.childPid!)).toBe(false);
  });

  it("aborts the whole run through the signal and still stops the child", async () => {
    const controller = new AbortController();
    const realStart = (await import("@/cloudflare/static-build/producer/child-server")).startChildServer;
    const result = await runStaticProducer(
      fixtureProducerInput(repo, {
        signal: controller.signal,
        // Abort only once the child is ready, so the abort lands in the crawl phase.
        startServer: async (spec, options) => {
          const running = await realStart(spec, options);
          setTimeout(() => controller.abort(), 150);
          return running;
        },
      }, ["--delay", "/catalog=5000", "--delay", "/about=5000", "--delay", "/catalog/brand/kamaz=5000", "--delay", "/contacts=5000"]),
    );
    expect(result).toMatchObject({ ok: false, code: "crawl_failed", reason: "aborted", cleanup: { ok: true } });
    if (result.ok) return;
    expect(result.childPid).toEqual(expect.any(Number));
    expect(isProcessAlive(result.childPid!)).toBe(false);
  });

  it("stops the child after a successful crawl", async () => {
    const result = await runStaticProducer(fixtureProducerInput(repo));
    expect(result).toMatchObject({ ok: true, cleanup: { ok: true, alreadyExited: false } });
    if (!result.ok) return;
    expect(isProcessAlive(result.childPid)).toBe(false);
  });

  it("keeps the primary failure when cleanup also fails", async () => {
    const fakeServer: RunningChildServer = {
      baseUrl: "http://127.0.0.1:9",
      pid: 0,
      stop: async () => ({ ok: false, reason: "child_stop_timeout" }),
    };
    const input: StaticProducerInput = fixtureProducerInput(repo, {
      limits: { requestTimeoutMs: 300, launchTimeoutMs: 1_000 },
      startServer: async () => fakeServer,
    });
    const result = await runStaticProducer(input);
    expect(result).toMatchObject({
      ok: false,
      code: "crawl_failed",
      cleanup: { ok: false, reason: "child_stop_timeout" },
    });
  });

  it("returns cleanup_failed when only cleanup fails", async () => {
    // Real crawl against a real fixture child, but the stop hook is replaced.
    const input = fixtureProducerInput(repo);
    const realStart = (await import("@/cloudflare/static-build/producer/child-server")).startChildServer;
    input.startServer = async (spec, options) => {
      const running = await realStart(spec, options);
      return {
        ...running,
        stop: async (stopOptions) => {
          await running.stop(stopOptions);
          return { ok: false, reason: "child_stop_timeout" };
        },
      };
    };
    const result = await runStaticProducer(input);
    expect(result).toMatchObject({ ok: false, code: "cleanup_failed", cleanup: { ok: false, reason: "child_stop_timeout" } });
    if (result.ok) return;
    expect(result.report?.summary.failed).toBe(0);
  });
});

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
