import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { STATIC_ASSET_MAX_FILE_BYTES } from "@/cloudflare/static-build/artifact-policy";
import { extractAssetReferences, readReferencedPublicAssets } from "@/cloudflare/static-build/producer/public-assets";
import { runStaticProducer } from "@/cloudflare/static-build/producer/run";
import { writeNextStaticAssets } from "@/cloudflare/static-build/producer/static-assets";
import { fixtureProducerInput, makeTempRepo, SITE_URL } from "./cloudflare-static-producer-support";

const linkType = process.platform === "win32" ? "junction" : "dir";
const temps: string[] = [];

afterEach(() => {
  for (const directory of temps.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function tempDir(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ayprom-public-assets-"));
  temps.push(directory);
  return directory;
}

function git(repo: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.autocrlf",
      GIT_CONFIG_VALUE_0: "false",
    },
  });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`);
}

function initRepo(): string {
  const repo = tempDir();
  git(repo, ["init", "-b", "main"]);
  return repo;
}

function track(repo: string, relativePath: string, contents: string | Buffer) {
  const absolute = path.join(repo, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
  git(repo, ["add", "--", relativePath]);
}

const routes = ["/"];
const origin = SITE_URL;

describe("public asset reference extraction", () => {
  it("does not interpret executable script literals as assets, but keeps JSON-LD images", () => {
    const text = '<script src="/_next/static/app.js">if(x==="/$"||x==="/&")go()</script>'
      + '<script type="application/ld+json">{"image":"/brand/logo.svg"}</script>';
    expect(extractAssetReferences({ text, baseUrlPath: "/catalog", siteOrigin: origin, routePaths: [] }))
      .toEqual({ assets: ["brand/logo.svg"], issues: [] });
  });
  it("does not mistake escaped quotes in a Next hydration string for URL delimiters", () => {
    const flight = JSON.stringify('1:{"src":"/brand/logo.svg","href":"/catalog"}');
    const html = `<img src="/brand/logo.svg"><script>self.__next_f.push([1,${flight}])</script>`;
    expect(extractAssetReferences({ text: html, baseUrlPath: "/catalog", siteOrigin: origin, routePaths: ["/catalog"] }))
      .toEqual({ assets: ["brand/logo.svg"], issues: [] });
  });

  it("keeps srcset and css urls and drops routes, api, next and external hosts", () => {
    const html = [
      '<img src="/images/logo.svg" srcset="/images/logo.svg 1x, /images/logo-2x.svg 2x">',
      '<a href="/catalog">каталог</a>',
      '<img src="/api/catalog/search?q=1">',
      '<script src="/_next/static/chunks/app.js"></script>',
      '<img src="https://media.ayprom-gidravlika.kg/a.webp">',
      '<img src="https://example.supabase.co/storage/v1/object/public/a.webp">',
      `<img src="${origin}/images/from-origin.svg">`,
      '<link rel="stylesheet" href="/styles/site.css">',
    ].join("");
    const css = 'body{background:url("/fonts/a.woff2")} .b{background:url(\'/fonts/b.woff2\')}';
    expect(extractAssetReferences({ text: html, baseUrlPath: "/", siteOrigin: origin, routePaths: ["/catalog"] }).assets)
      .toEqual(["images/logo.svg", "images/logo-2x.svg", "images/from-origin.svg", "styles/site.css"]);
    expect(extractAssetReferences({ text: css, baseUrlPath: "/styles/site.css", siteOrigin: origin, routePaths: [] }).assets)
      .toEqual(["fonts/a.woff2", "fonts/b.woff2"]);
  });

  it("does not treat a meta refresh target as a public file", () => {
    const html = '<meta http-equiv="refresh" content="1;url=/admin/products">';
    expect(extractAssetReferences({ text: html, baseUrlPath: "/", siteOrigin: origin, routePaths: [] })).toEqual({
      assets: [],
      issues: [],
    });
  });

  it("keeps an og:image content path as a public file", () => {
    const html = '<meta property="og:image" content="/images/logo.svg">';
    expect(extractAssetReferences({ text: html, baseUrlPath: "/", siteOrigin: origin, routePaths: [] }).assets)
      .toEqual(["images/logo.svg"]);
  });

  // Real catalog titles contain slashes inside words ("100л/мин", "KAMAZ 14/15 ISO"). Descriptive meta
  // text is not a file reference; only an address-shaped content value is.
  it.each([
    '<meta name="description" content="Гидравлический маслоохладитель 100л/мин 24V с датчиком температуры. Доставка">',
    '<meta property="og:title" content="Коробка отбора мощности на KAMAZ 14/15 ISO">',
    '<meta property="og:title" content="SCANIA R124GA/CB-R164 GA">',
  ])("does not treat descriptive meta text with a slash as a file: %s", (html) => {
    expect(extractAssetReferences({ text: html, baseUrlPath: "/", siteOrigin: origin, routePaths: [] })).toEqual({
      assets: [],
      issues: [],
    });
  });

  it("still keeps same-origin absolute and root-relative content addresses, and rejects an unsafe one", () => {
    const html = `<meta property="og:image" content="${origin}/images/a.webp"><meta name="twitter:image" content="/images/b.webp">`;
    expect(extractAssetReferences({ text: html, baseUrlPath: "/", siteOrigin: origin, routePaths: [] }).assets)
      .toEqual(["images/a.webp", "images/b.webp"]);
    const unsafe = '<meta property="og:image" content="/images/../../secret.txt">';
    expect(extractAssetReferences({ text: unsafe, baseUrlPath: "/", siteOrigin: origin, routePaths: [] }).issues)
      .toEqual([{ field: "/images/../../secret.txt", rule: "invalid_path" }]);
  });

  it("rejects traversal and encoded traversal without using the path", () => {
    const text = '<img src="/images/../../secret.txt"><img src="/images/%2e%2e/%2e%2e/secret.txt"><img src="/images/%252e%252e/secret.txt">';
    const extracted = extractAssetReferences({ text, baseUrlPath: "/", siteOrigin: origin, routePaths: routes });
    expect(extracted.assets).toEqual([]);
    expect(extracted.issues.map((issue) => issue.rule)).toEqual(["invalid_path", "invalid_path", "invalid_path"]);
  });
});

describe("referenced tracked public files", { timeout: 20_000 }, () => {
  it("copies a referenced tracked file and leaves an unused tracked file behind", async () => {
    const repo = initRepo();
    track(repo, "public/images/logo.svg", "<svg>logo</svg>\n");
    track(repo, "public/images/unused.svg", "<svg>unused</svg>\n");
    const site = path.join(tempDir(), "site");
    mkdirSync(site);
    writeFileSync(path.join(site, "index.html"), '<img src="/images/logo.svg?v=1#mark">');

    const planned = await readReferencedPublicAssets({
      siteDir: site,
      publicDir: path.join(repo, "public"),
      repoRoot: repo,
      siteOrigin: origin,
      routePaths: routes,
      reservedOutputFiles: ["index.html"],
    });
    await writeNextStaticAssets(site, planned);

    expect(planned.map((asset) => asset.outputFile)).toEqual(["images/logo.svg"]);
    const written = readFileSync(path.join(site, "images/logo.svg"));
    expect(written.toString("utf8")).toBe("<svg>logo</svg>\n");
    expect(planned[0]?.sha256).toBe(createHash("sha256").update(written).digest("hex"));
    expect(planned[0]?.bytes.byteLength).toBe(written.byteLength);
    expect(existsSync(path.join(site, "images/unused.svg"))).toBe(false);
  });

  it("copies files reached through srcset and a referenced stylesheet", async () => {
    const repo = initRepo();
    track(repo, "public/images/logo.svg", "one");
    track(repo, "public/images/logo-2x.svg", "two");
    track(repo, "public/styles/site.css", '@font-face{src:url("/fonts/a.woff2")}\n');
    track(repo, "public/fonts/a.woff2", "font-bytes");
    const site = path.join(tempDir(), "site");
    mkdirSync(site);
    writeFileSync(path.join(site, "index.html"), '<img srcset="/images/logo.svg 1x, /images/logo-2x.svg 2x"><link href="/styles/site.css" rel="stylesheet">');

    const planned = await readReferencedPublicAssets({
      siteDir: site, publicDir: path.join(repo, "public"), repoRoot: repo,
      siteOrigin: origin, routePaths: routes, reservedOutputFiles: ["index.html"],
    });
    expect(planned.map((asset) => asset.outputFile)).toEqual([
      "fonts/a.woff2", "images/logo-2x.svg", "images/logo.svg", "styles/site.css",
    ]);
  });

  // Regression (staging): five vehicle photos are named only inside lazily loaded JS and hydration data,
  // so they were missing from the package and showed as broken images. Any tracked public file whose
  // full path appears as a literal in built output must be copied.
  it("copies tracked files named only in a JS chunk or in hydration data, not unrelated ones", async () => {
    const repo = initRepo();
    track(repo, "public/images/vehicle-showcase/a.webp", "a");
    track(repo, "public/images/vehicle-showcase/b-mobile.webp", "b");
    track(repo, "public/images/vehicle-showcase/c.webp", "c");
    track(repo, "public/images/never-mentioned.webp", "n");
    const site = path.join(tempDir(), "site");
    mkdirSync(path.join(site, "_next/static/chunks"), { recursive: true });
    writeFileSync(path.join(site, "index.html"),
      '<p>x</p><script>self.__next_f.push([1,"{\\"image\\":\\"/images/vehicle-showcase/b-mobile.webp\\"}"])</script>');
    writeFileSync(path.join(site, "_next/static/chunks/app.js"), 'const v=[{image:"/images/vehicle-showcase/a.webp"}];');
    writeFileSync(path.join(site, "_next/static/chunks/other.js"), 'const x="https://cdn.example.test/images/vehicle-showcase/c.webp";');

    const planned = await readReferencedPublicAssets({
      siteDir: site, publicDir: path.join(repo, "public"), repoRoot: repo,
      siteOrigin: origin, routePaths: routes, reservedOutputFiles: ["index.html"],
    });
    expect(planned.map((asset) => asset.outputFile)).toEqual([
      "images/vehicle-showcase/a.webp", "images/vehicle-showcase/b-mobile.webp",
    ]);
  });

  it("does not treat a longer name as a mention of a shorter tracked file", async () => {
    const repo = initRepo();
    track(repo, "public/images/a.webp", "a");
    const site = path.join(tempDir(), "site");
    mkdirSync(path.join(site, "_next/static/chunks"), { recursive: true });
    writeFileSync(path.join(site, "index.html"), "<p>x</p>");
    writeFileSync(path.join(site, "_next/static/chunks/app.js"), 'const m="/images/a.webp.map",n="/images/a.webpx";');
    const planned = await readReferencedPublicAssets({
      siteDir: site, publicDir: path.join(repo, "public"), repoRoot: repo,
      siteOrigin: origin, routePaths: routes, reservedOutputFiles: ["index.html"],
    });
    expect(planned).toEqual([]);
  });

  // Never ship a broken image again: a literal that points into a public folder but names no tracked
  // file fails the build instead of silently producing a 404 on the live site.
  it("fails the build when a script names a missing file inside a known public folder", async () => {
    const repo = initRepo();
    track(repo, "public/images/real.webp", "r");
    const site = path.join(tempDir(), "site");
    mkdirSync(path.join(site, "_next/static/chunks"), { recursive: true });
    writeFileSync(path.join(site, "index.html"), "<p>x</p>");
    writeFileSync(path.join(site, "_next/static/chunks/app.js"), 'const a="/images/real.webp",b="/images/ghost.webp";');
    await expect(readReferencedPublicAssets({
      siteDir: site, publicDir: path.join(repo, "public"), repoRoot: repo,
      siteOrigin: origin, routePaths: routes, reservedOutputFiles: ["index.html"],
    })).rejects.toMatchObject({
      issues: [expect.objectContaining({ field: "images/ghost.webp", rule: "missing_public_asset" })],
    });
  });

  it("reports an untracked on-disk file instead of copying it", async () => {
    const repo = initRepo();
    const secret = "SHOULD_NOT_COPY_UNTRACKED";
    const absolute = path.join(repo, "public", "images", "extra.svg");
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, secret);
    const site = path.join(tempDir(), "site");
    mkdirSync(site);
    writeFileSync(path.join(site, "index.html"), '<img src="/images/extra.svg">');

    let thrown: unknown;
    try {
      await readReferencedPublicAssets({
        siteDir: site, publicDir: path.join(repo, "public"), repoRoot: repo,
        siteOrigin: origin, routePaths: routes, reservedOutputFiles: ["index.html"],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: "artifact_policy_failed",
      issues: [expect.objectContaining({ field: "images/extra.svg", rule: "untracked_public_asset" })],
    });
    expect(JSON.stringify(thrown)).not.toContain(secret);
    expect(existsSync(path.join(site, "images/extra.svg"))).toBe(false);
  });

  it("reports a referenced asset that is not in git and not on disk", async () => {
    const repo = initRepo();
    const site = path.join(tempDir(), "site");
    mkdirSync(site);
    writeFileSync(path.join(site, "index.html"), '<img src="/images/missing.png">');

    await expect(readReferencedPublicAssets({
      siteDir: site, publicDir: path.join(repo, "public"), repoRoot: repo,
      siteOrigin: origin, routePaths: routes, reservedOutputFiles: ["index.html"],
    })).rejects.toMatchObject({
      issues: [expect.objectContaining({ field: "images/missing.png", rule: "missing_public_asset" })],
    });
  });

  it("rejects a case collision with the tracked spelling before reading the file", async () => {
    const repo = initRepo();
    const secret = "SHOULD_NOT_READ_CASE";
    track(repo, "public/images/logo.svg", secret);
    const site = path.join(tempDir(), "site");
    mkdirSync(site);
    writeFileSync(path.join(site, "index.html"), '<img src="/images/Logo.svg">');

    let thrown: unknown;
    try {
      await readReferencedPublicAssets({
        siteDir: site, publicDir: path.join(repo, "public"), repoRoot: repo,
        siteOrigin: origin, routePaths: routes, reservedOutputFiles: ["index.html"],
        trackedPublicFiles: ["images/logo.svg"],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      issues: [expect.objectContaining({ field: "images/Logo.svg", rule: "case_insensitive_collision" })],
    });
    expect(JSON.stringify(thrown)).not.toContain(secret);
  });

  it("rejects a junction inside public before reading the target", async () => {
    const repo = initRepo();
    track(repo, "public/images/logo.svg", "tracked-before-swap");
    const outside = path.join(tempDir(), "outside");
    mkdirSync(outside);
    const secret = "SHOULD_NOT_READ_JUNCTION";
    writeFileSync(path.join(outside, "logo.svg"), secret);
    rmSync(path.join(repo, "public", "images"), { recursive: true, force: true });
    symlinkSync(outside, path.join(repo, "public", "images"), linkType);
    const site = path.join(tempDir(), "site");
    mkdirSync(site);
    writeFileSync(path.join(site, "index.html"), '<img src="/images/logo.svg">');

    try {
      let thrown: unknown;
      try {
        await readReferencedPublicAssets({
          siteDir: site, publicDir: path.join(repo, "public"), repoRoot: repo,
          siteOrigin: origin, routePaths: routes, reservedOutputFiles: ["index.html"],
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({
        code: "artifact_policy_failed",
        issues: [expect.objectContaining({ rule: "outside_source_realpath" })],
      });
      expect(JSON.stringify(thrown)).not.toContain(secret);
      expect(readFileSync(path.join(outside, "logo.svg"), "utf8")).toBe(secret);
    } finally {
      unlinkSync(path.join(repo, "public", "images"));
    }
  });

  it("rejects a file above the artifact limit before copying it", async () => {
    const repo = initRepo();
    track(repo, "public/images/big.bin", Buffer.alloc(STATIC_ASSET_MAX_FILE_BYTES + 1));
    const site = path.join(tempDir(), "site");
    mkdirSync(site);
    writeFileSync(path.join(site, "index.html"), '<img src="/images/big.bin">');

    await expect(readReferencedPublicAssets({
      siteDir: site, publicDir: path.join(repo, "public"), repoRoot: repo,
      siteOrigin: origin, routePaths: routes, reservedOutputFiles: ["index.html"],
    })).rejects.toMatchObject({
      issues: [expect.objectContaining({ field: "images/big.bin", rule: "file_too_large" })],
    });
    expect(existsSync(path.join(site, "images"))).toBe(false);
  });

  it("rejects a reference that collides with an already written document", async () => {
    const repo = initRepo();
    const secret = "SHOULD_NOT_REPLACE_INDEX";
    track(repo, "public/index.html", secret);
    const site = path.join(tempDir(), "site");
    mkdirSync(site);
    writeFileSync(path.join(site, "index.html"), "<h1>crawled</h1>");
    writeFileSync(path.join(site, "about.html"), '<a href="/index.html">home</a>');

    let thrown: unknown;
    try {
      await readReferencedPublicAssets({
        siteDir: site, publicDir: path.join(repo, "public"), repoRoot: repo,
        siteOrigin: origin, routePaths: ["/", "/about"], reservedOutputFiles: ["index.html", "about.html"],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      issues: [expect.objectContaining({ field: "index.html", rule: "duplicate_path" })],
    });
    expect(readFileSync(path.join(site, "index.html"), "utf8")).toBe("<h1>crawled</h1>");
    expect(JSON.stringify(thrown)).not.toContain(secret);
  });
});

describe("public assets in the producer", { timeout: 30_000 }, () => {
  it("keeps the fixture crawl unchanged when no public repository is requested", async () => {
    const repo = makeTempRepo();
    temps.push(repo.repoRoot);
    const before = repo.siteSnapshot();
    const result = await runStaticProducer(fixtureProducerInput(repo));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.publicAssets).toBeUndefined();
    expect(repo.siteSnapshot()).toEqual(before);
  });

  it("does not copy unused or untracked public files during a fixture crawl", async () => {
    const stagingRepo = makeTempRepo();
    temps.push(stagingRepo.repoRoot);
    const before = stagingRepo.siteSnapshot();
    const source = initRepo();
    track(source, "public/images/unused.svg", "<svg>unused</svg>");
    mkdirSync(path.join(source, "public", "images"), { recursive: true });
    writeFileSync(path.join(source, "public", "images", "extra.svg"), "untracked");

    const result = await runStaticProducer(fixtureProducerInput(stagingRepo, { publicRepoRoot: source }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.publicAssets).toEqual({ fileCount: 0, totalBytes: 0, files: [] });
    expect(existsSync(path.join(result.siteDir, "images"))).toBe(false);
    expect(stagingRepo.siteSnapshot()).toEqual(before);
  });

  it("refuses a missing referenced asset without writing public files or touching dist/site", async () => {
    const stagingRepo = makeTempRepo();
    temps.push(stagingRepo.repoRoot);
    const before = stagingRepo.siteSnapshot();
    const source = initRepo();
    const serverPath = path.join(tempDir(), "server.mjs");
    writeFileSync(serverPath, `
      import http from "node:http";
      const server = http.createServer((request, response) => {
        const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
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
        if (pathname === "/ayprom-static-build-not-found-probe") {
          response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
          response.end("<h1>missing</h1>");
          return;
        }
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end('<img src="/images/missing.png">');
      });
      server.listen(0, "127.0.0.1", () => {
        process.stdout.write("Ready on http://127.0.0.1:" + server.address().port + "\\n");
      });
    `);

    const result = await runStaticProducer(fixtureProducerInput(stagingRepo, {
      publicRepoRoot: source,
      server: {
        command: process.execPath,
        args: [serverPath],
        cwd: stagingRepo.repoRoot,
        readyPattern: /Ready on (http:\/\/127\.0\.0\.1:\d+)/,
      },
    }));
    expect(result).toMatchObject({
      ok: false,
      code: "artifact_policy_failed",
      issues: [expect.objectContaining({ field: "images/missing.png", rule: "missing_public_asset" })],
    });
    if (result.ok) return;
    expect(result.stagingDir === null || !existsSync(path.join(result.stagingDir, "site", "images"))).toBe(true);
    expect(stagingRepo.siteSnapshot()).toEqual(before);
  });
});
