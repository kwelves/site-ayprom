import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyStagedDocuments, type VerificationReport } from "@/cloudflare/static-build/producer/html-verification";
import { runStaticProducer } from "@/cloudflare/static-build/producer/run";
import type { RouteManifestEntry } from "@/cloudflare/static-build/route-manifest";
import { fixtureProducerInput, makeTempRepo, SITE_URL } from "./cloudflare-static-producer-support";

const temps: string[] = [];

afterEach(() => {
  for (const directory of temps.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function tempDir(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ayprom-html-verify-"));
  temps.push(directory);
  return directory;
}

interface Page {
  class: "static";
  family: "home" | "not-found" | "about";
  path: string;
  outputFile: string;
  expectedCanonical: string | null;
  expectedJsonLdTypes: string[];
  expectedIndexable: boolean;
  snapshotIds: string[];
}

function page(pathName: string, canonical: string | null, jsonLd: string[], indexable = true): Page {
  const outputFile = pathName === "/" ? "index.html" : pathName === "/404" ? "404.html" : `${pathName.slice(1)}.html`;
  return {
    class: "static",
    family: pathName === "/" ? "home" : pathName === "/404" ? "not-found" : "about",
    path: pathName,
    outputFile,
    expectedCanonical: canonical,
    expectedJsonLdTypes: jsonLd,
    expectedIndexable: indexable,
    snapshotIds: ["fixture"],
  };
}

function html(options: {
  title?: string;
  canonicals?: string[];
  h1?: string[];
  jsonLd?: string[];
  robots?: string;
  extra?: string;
}): string {
  const canonicals = (options.canonicals ?? []).map((href) => `<link rel="canonical" href="${href}">`).join("");
  const jsonLd = (options.jsonLd ?? []).map((type) =>
    `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": type })}</script>`).join("");
  const robots = options.robots ? `<meta name="robots" content="${options.robots}">` : "";
  const headings = (options.h1 ?? ["Заголовок"]).map((text) => `<h1>${text}</h1>`).join("");
  const title = options.title === undefined ? "Заголовок" : options.title;
  return `<!doctype html><html><head><title>${title}</title>${canonicals}${robots}${jsonLd}</head><body>${headings}${options.extra ?? ""}</body></html>`;
}

function writePage(site: string, outputFile: string, contents: string) {
  const absolute = path.join(site, outputFile);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

const canonical = `${SITE_URL}/about`;

describe("staged HTML verification", () => {
  it("accepts one canonical, title, h1 and the expected JSON-LD types", async () => {
    const site = path.join(tempDir(), "site");
    const entry = page("/about", canonical, ["BreadcrumbList"]);
    writePage(site, entry.outputFile, html({ canonicals: [canonical], jsonLd: ["BreadcrumbList"] }));
    const alias: RouteManifestEntry = {
      class: "redirect", family: "product-alias", path: "/product/shaft",
      redirectTo: "/catalog/category/pto/brand/kamaz/shaft", status: 308, snapshotIds: ["shaft"],
    };

    const robots: RouteManifestEntry = {
      class: "static", family: "robots", path: "/robots.txt", outputFile: "robots.txt",
      expectedCanonical: null, expectedJsonLdTypes: [], expectedIndexable: false, snapshotIds: ["fixture"],
    };
    const report = await verifyStagedDocuments(site, [entry, alias, robots]);
    expect(report.ok).toBe(true);
    expect(report.documents).toEqual([{ path: "/about", outputFile: "about.html", ok: true }]);
    expect(report.failures).toEqual([]);
    expect(report.pendingAliases).toEqual([{
      path: "/product/shaft",
      redirectTo: "/catalog/category/pto/brand/kamaz/shaft",
      status: 308,
      runtime: "pending",
    }]);
  });

  it("rejects a missing canonical and a second canonical", async () => {
    const site = path.join(tempDir(), "site");
    const missing = page("/about", canonical, []);
    const doubled = page("/contacts", `${SITE_URL}/contacts`, []);
    writePage(site, missing.outputFile, html({ canonicals: [] }));
    writePage(site, doubled.outputFile, html({ canonicals: [`${SITE_URL}/contacts`, `${SITE_URL}/contacts`] }));

    const report = await verifyStagedDocuments(site, [doubled, missing]);
    expect(report.ok).toBe(false);
    expect(report.failures).toEqual([
      { path: "/about", outputFile: "about.html", rule: "canonical_missing" },
      { path: "/contacts", outputFile: "contacts.html", rule: "canonical_duplicate" },
    ]);
  });

  it("rejects a page without exactly one logical h1", async () => {
    const site = path.join(tempDir(), "site");
    const entry = page("/about", canonical, []);
    writePage(site, entry.outputFile, html({ canonicals: [canonical], h1: [] }));
    const report = await verifyStagedDocuments(site, [entry]);
    expect(report.failures).toEqual([{ path: "/about", outputFile: "about.html", rule: "h1_count" }]);
  });

  it("rejects JSON-LD types that differ from the manifest", async () => {
    const site = path.join(tempDir(), "site");
    const entry = page("/", `${SITE_URL}/`, ["WebSite", "AutoPartsStore"]);
    writePage(site, entry.outputFile, html({ canonicals: [`${SITE_URL}/`], jsonLd: ["WebSite"] }));
    const report = await verifyStagedDocuments(site, [entry]);
    expect(report.failures).toEqual([{ path: "/", outputFile: "index.html", rule: "json_ld_mismatch" }]);
  });

  it("rejects an indexable page marked noindex and a 404 without noindex", async () => {
    const site = path.join(tempDir(), "site");
    const about = page("/about", canonical, []);
    const missing = page("/404", null, [], false);
    writePage(site, about.outputFile, html({ canonicals: [canonical], robots: "noindex" }));
    writePage(site, missing.outputFile, html({ canonicals: [], h1: ["Не найдено"] }));
    const report = await verifyStagedDocuments(site, [missing, about]);
    expect(report.failures).toEqual([
      { path: "/404", outputFile: "404.html", rule: "noindex_missing" },
      { path: "/about", outputFile: "about.html", rule: "indexability_mismatch" },
    ]);
  });

  it("rejects a forbidden url without copying that url into the report", async () => {
    const site = path.join(tempDir(), "site");
    const entry = page("/about", canonical, []);
    const secretUrl = "http://127.0.0.1:3001/_next/image?url=preview.vercel.app/secret-token";
    writePage(site, entry.outputFile, html({ canonicals: [canonical], extra: `<img src="${secretUrl}">` }));
    const report = await verifyStagedDocuments(site, [entry]);
    expect(report.failures).toEqual([{ path: "/about", outputFile: "about.html", rule: "forbidden_url" }]);
    expect(JSON.stringify(report)).not.toContain("secret-token");
    expect(JSON.stringify(report)).not.toContain("127.0.0.1");
  });

  it("serializes the same report for the same documents", async () => {
    const site = path.join(tempDir(), "site");
    const first = page("/about", canonical, ["BreadcrumbList"]);
    const second = page("/contacts", `${SITE_URL}/contacts`, []);
    writePage(site, first.outputFile, html({ canonicals: [canonical], jsonLd: ["BreadcrumbList"] }));
    writePage(site, second.outputFile, html({ canonicals: [`${SITE_URL}/contacts`] }));
    const forward = await verifyStagedDocuments(site, [second, first]);
    const reverse = await verifyStagedDocuments(site, [first, second]);
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reverse));
    expect(forward.documents.map((document) => document.path)).toEqual(["/about", "/contacts"]);
  });
});

describe("producer SEO gate", { timeout: 30_000 }, () => {
  it("does not change dist/site when HTML verification fails", async () => {
    const repo = makeTempRepo();
    temps.push(repo.repoRoot);
    const before = repo.siteSnapshot();
    const input = fixtureProducerInput(repo, {
      server: ({ routeManifestPath }) => ({
        command: process.execPath,
        args: ["-e", bareServer(routeManifestPath)],
        cwd: repo.repoRoot,
        readyPattern: /Ready on (http:\/\/127\.0\.0\.1:\d+)/,
      }),
    });
    const result = await runStaticProducer(input);
    expect(result).toMatchObject({
      ok: false,
      code: "seo_verification_failed",
      stagingDir: expect.any(String),
    });
    if (result.ok || !result.stagingDir) return;
    const verification = JSON.parse(readFileSync(path.join(result.stagingDir, "meta", "verification-report.json"), "utf8")) as VerificationReport;
    expect(verification.ok).toBe(false);
    expect(verification.failures.some((failure) => failure.rule === "canonical_missing")).toBe(true);
    expect(verification.pendingAliases.every((alias) => alias.runtime === "pending")).toBe(true);
    expect(repo.siteSnapshot()).toEqual(before);
  });
});

function bareServer(routeManifestPath: string): string {
  const manifest = JSON.stringify(routeManifestPath);
  return `
    const http = require("node:http");
    const fs = require("node:fs");
    const manifest = JSON.parse(fs.readFileSync(${manifest}, "utf8"));
    const documents = new Set(manifest.entries.filter((entry) => entry.class === "static" || entry.class === "query").map((entry) => entry.path));
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/robots.txt") {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end("User-agent: *\\n");
        return;
      }
      if (pathname === "/sitemap.xml") {
        response.writeHead(200, { "content-type": "application/xml" });
        response.end("<urlset></urlset>");
        return;
      }
      const status = documents.has(pathname) && pathname !== "/404" ? 200 : 404;
      response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><head><title>Без canonical</title></head><body><h1>Без canonical</h1></body></html>");
    });
    server.listen(0, "127.0.0.1", () => {
      process.stdout.write("Ready on http://127.0.0.1:" + server.address().port + "\\n");
    });
  `;
}
