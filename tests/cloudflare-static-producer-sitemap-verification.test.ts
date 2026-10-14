import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifySitemapXml } from "@/cloudflare/static-build/producer/sitemap-verification";
import { runStaticProducer } from "@/cloudflare/static-build/producer/run";
import { fixtureProducerInput, fixtureRoutes, makeTempRepo, SITE_URL } from "./cloudflare-static-producer-support";

const origin = SITE_URL;
const temps: string[] = [];

afterEach(() => {
  for (const directory of temps.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function loc(pathname: string): string {
  return `${origin}${pathname === "/" ? "" : pathname}`;
}

function sitemap(paths: string[]): string {
  const urls = paths.map((pathname) => `  <url><loc>${loc(pathname)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset>\n${urls}\n</urlset>\n`;
}

describe("sitemap verification", () => {
  it("matches the expected urls regardless of xml element order", () => {
    const expected = ["/", "/catalog", "/about"];
    const forward = verifySitemapXml(sitemap(expected), expected, origin);
    const reverse = verifySitemapXml(sitemap([...expected].reverse()), expected, origin);
    expect(forward.ok).toBe(true);
    expect(forward.failures).toEqual([]);
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reverse));
  });

  it("reports a missing url, an extra url and a repeated url", () => {
    const xml = sitemap(["/catalog", "/catalog", "/extra"]);
    const report = verifySitemapXml(xml, ["/", "/catalog"], origin);
    expect(report.ok).toBe(false);
    expect(report.failures.map((failure) => failure.rule)).toEqual([
      "sitemap_url_duplicate",
      "sitemap_url_missing",
      "sitemap_url_unexpected",
    ]);
  });

  it("reports a url on another origin without copying the address into a secret-bearing field", () => {
    const foreign = "https://preview.example/catalog?token=secret-token";
    const xml = `<?xml version="1.0"?><urlset><url><loc>${loc("/")}</loc></url><url><loc>${foreign}</loc></url></urlset>`;
    const report = verifySitemapXml(xml, ["/"], origin);
    expect(report.failures).toEqual([
      { url: "https://preview.example/catalog", rule: "sitemap_url_origin" },
    ]);
    expect(JSON.stringify(report)).not.toContain("secret-token");
  });

  it("accepts a real catalog path that contains the word public", () => {
    const report = verifySitemapXml(sitemap(["/catalog/public"]), ["/catalog/public"], origin);
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it("accepts a prefixed sitemap namespace and rejects text before the root", () => {
    const prefixed = `<s:urlset xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"><s:url><s:loc>${loc("/about")}</s:loc></s:url></s:urlset>`;
    const leading = `not XML${sitemap(["/about"])}`;
    expect(verifySitemapXml(prefixed, ["/about"], origin).ok).toBe(true);
    expect(verifySitemapXml(leading, ["/about"], origin).ok).toBe(false);
    expect(verifySitemapXml(leading, ["/about"], origin).failures.map((failure) => failure.rule)).toEqual(["sitemap_malformed"]);
  });

  it("rejects trailing junk and a loc that is not inside url", () => {
    const trailing = verifySitemapXml(`${sitemap(["/about"])}not XML<`, ["/about"], origin);
    const bareLoc = verifySitemapXml(`<urlset><loc>${loc("/about")}</loc></urlset>`, ["/about"], origin);
    expect(trailing.ok).toBe(false);
    expect(bareLoc.ok).toBe(false);
    expect(trailing.failures.map((failure) => failure.rule)).toEqual(["sitemap_malformed"]);
    expect(bareLoc.failures.map((failure) => failure.rule)).toEqual(["sitemap_malformed"]);
  });

  it("rejects two roots, a missing loc, an empty loc and a second loc", () => {
    const twoRoots = verifySitemapXml(`<urlset></urlset><urlset></urlset>`, [], origin);
    const missing = verifySitemapXml(`<urlset><url></url></urlset>`, ["/about"], origin);
    const empty = verifySitemapXml(`<urlset><url><loc> </loc></url></urlset>`, ["/about"], origin);
    const doubled = verifySitemapXml(
      `<urlset><url><loc>${loc("/about")}</loc><loc>${loc("/about")}</loc></url></urlset>`,
      ["/about"],
      origin,
    );
    for (const report of [twoRoots, missing, empty, doubled]) {
      expect(report.ok).toBe(false);
      expect(report.failures.map((failure) => failure.rule)).toContain("sitemap_malformed");
    }
  });

  it("decodes a numeric xml entity inside loc", () => {
    const xml = `<urlset><url><loc>${origin}/catalog/a&#38;b</loc></url></urlset>`;
    expect(verifySitemapXml(xml, ["/catalog/a&b"], origin).ok).toBe(true);
  });

  it("reads an escaped sitemap loc and ignores image:loc", () => {
    const xml = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${origin}/catalog/a&amp;b</loc>
    <lastmod>2026-09-24</lastmod>
    <image:image><image:loc>https://media.example/a.webp</image:loc></image:image>
  </url>
</urlset>`;
    const report = verifySitemapXml(xml, ["/catalog/a&b"], origin);
    expect(report.ok).toBe(true);
    expect(report.found).toBe(1);
  });

  it("rejects a broken sitemap and an unclosed urlset", () => {
    const broken = verifySitemapXml(`<broken><loc>${loc("/about")}</loc>`, ["/about"], origin);
    const unclosed = verifySitemapXml(`<urlset><url><loc>${loc("/about")}</loc></url>`, ["/about"], origin);
    expect(broken.ok).toBe(false);
    expect(broken.failures.map((failure) => failure.rule)).toEqual(["sitemap_root"]);
    expect(unclosed.ok).toBe(false);
    expect(unclosed.failures.map((failure) => failure.rule)).toEqual(["sitemap_malformed"]);
    expect(JSON.stringify(broken) + JSON.stringify(unclosed)).not.toContain("<broken>");
  });

  it("reports a product alias that was published in the sitemap", () => {
    const xml = sitemap(["/", "/product/shaft"]);
    const report = verifySitemapXml(xml, ["/"], origin, ["/product/shaft"]);
    expect(report.failures).toEqual([
      { url: loc("/product/shaft"), rule: "product_alias_in_sitemap" },
    ]);
  });

  it("rejects an external xml entity without requesting it", () => {
    const xml = `<!DOCTYPE urlset [<!ENTITY secret SYSTEM "https://evil.example/secret-token">]><urlset><url><loc>&secret;</loc></url></urlset>`;
    const report = verifySitemapXml(xml, ["/"], origin);
    expect(report.ok).toBe(false);
    expect(report.failures).toEqual([{ url: "", rule: "sitemap_external_entity" }]);
    expect(JSON.stringify(report)).not.toContain("secret-token");
  });
});

describe("producer sitemap gate", { timeout: 30_000 }, () => {
  it("rejects a missing sitemap path list before starting the child", async () => {
    const repo = makeTempRepo();
    temps.push(repo.repoRoot);
    const marker = path.join(repo.repoRoot, "spawned.txt");
    const result = await runStaticProducer(fixtureProducerInput(repo, {
      sitemapPaths: undefined,
      server: {
        command: process.execPath,
        args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "spawned")`],
        cwd: repo.repoRoot,
        readyPattern: /Ready on (\S+)/,
      },
    }));
    expect(result).toMatchObject({
      ok: false,
      code: "sitemap_verification_failed",
      stagingDir: null,
      childPid: null,
      issues: [{ field: "sitemapPaths", rule: "required" }],
    });
    expect(existsSync(marker)).toBe(false);
  });

  it("does not change dist/site when the crawled sitemap disagrees", async () => {
    const repo = makeTempRepo();
    temps.push(repo.repoRoot);
    const before = repo.siteSnapshot();
    const result = await runStaticProducer(fixtureProducerInput(repo, {}, ["--corrupt-sitemap"]));
    expect(result).toMatchObject({ ok: false, code: "sitemap_verification_failed" });
    if (result.ok || !result.stagingDir) return;
    expect(readFileSync(path.join(result.stagingDir, "meta", "sitemap-verification.json"), "utf8")).toContain("sitemap_url_unexpected");
    expect(repo.siteSnapshot()).toEqual(before);
  });

  it("accepts derivePublicRoutes entries when the crawled xml lists exactly those paths", () => {
    const { sitemapEntries } = fixtureRoutes();
    const paths = sitemapEntries.map((entry) => entry.path);
    const report = verifySitemapXml(sitemap([...paths].reverse()), paths, origin);
    expect(report.ok).toBe(true);
    expect(report.expected).toBe(paths.length);
  });
});
