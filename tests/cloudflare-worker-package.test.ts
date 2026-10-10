import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { serializeAliasWorkerEntry } from "@/cloudflare/static-build/producer/alias-worker";
import { packageAdminPreview, packageWorkerAssets as packageWorkerAssetsReal, verifyPackagedWorker } from "../scripts/cloudflare/package-worker-assets-lib.mjs";
import { prepareAdminPreviewAssets } from "../scripts/cloudflare/admin-preview-assets.mjs";
import { verifyPackageIntegrity } from "../scripts/cloudflare/package-integrity.mjs";

const temps: string[] = [];
const worktree = path.resolve(".");

afterEach(() => {
  for (const directory of temps.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function tempDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "ayprom-worker-package-"));
  temps.push(directory);
  return directory;
}

function makeRepo({ createPackageArea = true } = {}): string {
  const root = tempDir();
  if (createPackageArea) mkdirSync(path.join(root, "dist", "worker-packages"), { recursive: true });
  mkdirSync(path.join(root, "dist", "staging"), { recursive: true });
  return root;
}

function writeReports(staging: string, patch: { crawl?: object; html?: object; sitemap?: object; links?: object } = {}) {
  const meta = path.join(staging, "meta");
  mkdirSync(meta, { recursive: true });
  const files = {
    "crawl-report.json": { summary: { failed: 0, written: 3, routes: 3 }, ...patch.crawl },
    "verification-report.json": { ok: true, ...patch.html },
    "sitemap-verification.json": { ok: true, ...patch.sitemap },
    "link-verification.json": { ok: true, ...patch.links },
  };
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(path.join(meta, name), JSON.stringify(value));
  }
}

function writeStaging(repo: string, options: { reports?: boolean; siteFiles?: Record<string, string>; crawl?: object; html?: object; sitemap?: object; links?: object } = {}) {
  const staging = path.join(repo, "dist", "staging", "run");
  const meta = path.join(staging, "meta");
  const site = path.join(staging, "site");
  mkdirSync(meta, { recursive: true });
  mkdirSync(site, { recursive: true });
  const entry = serializeAliasWorkerEntry(
    [
      { path: "/product/shaft", redirectTo: "/catalog/category/pto/shaft", status: 308 },
      { path: "/product/cog", redirectTo: "/catalog/category/pto/cog", status: 308 },
    ],
    path.relative(meta, path.join(worktree, "src/cloudflare/worker.ts")).replaceAll("\\", "/"),
    path.relative(meta, path.join(worktree, "src/cloudflare/product-alias-redirects.ts")).replaceAll("\\", "/"),
  );
  writeFileSync(path.join(meta, "alias-worker-entry.mjs"), entry);
  writeFileSync(path.join(meta, "note.txt"), "service_role must stay in meta");
  const siteFiles = options.siteFiles ?? {
    "index.html": "<main id=\"top\">AYPROM</main>",
    "catalog/category/pto/shaft.html": "<h1>Вал</h1>",
    "404.html": "missing",
  };
  for (const [relativePath, contents] of Object.entries(siteFiles)) {
    const file = path.join(site, relativePath);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
  if (options.reports !== false) {
    writeReports(staging, options);
  }
  writeFileSync(path.join(meta, "publication-revision-report.json"), JSON.stringify({ schemaVersion: 1, ok: true, revision: 7 }));
  return staging;
}

function packageWorkerAssets(options: Parameters<typeof packageWorkerAssetsReal>[0]) {
  return packageWorkerAssetsReal({ readCurrentRevision: async () => 7, ...options });
}

function packagePath(repo: string, name = "pkg"): string {
  return path.join(repo, "dist", "worker-packages", name);
}

function previewRepo(): string {
  const repo = makeRepo();
  for (const name of ["login.html", "index.html", "security.html"]) {
    const relative = `fixtures/cloudflare-admin-assets/admin/${name}`;
    mkdirSync(path.dirname(path.join(repo, relative)), { recursive: true });
    writeFileSync(path.join(repo, relative), readFileSync(path.join(worktree, relative)));
  }
  for (const args of [["init", "--quiet"], ["add", "--", "fixtures"]]) {
    expect(spawnSync("git", args, { cwd: repo, windowsHide: true }).status).toBe(0);
  }
  return repo;
}

describe("explicit admin preview package", () => {
  it("counts the three admin files in the combined asset limit", async () => {
    const repo = previewRepo();
    const files = Array.from({ length: 19_997 }, (_, index) => ({ relativePath: `files/${index}.txt`, bytes: Buffer.from("safe") }));
    expect(await prepareAdminPreviewAssets(repo, files)).toHaveLength(20_000);
    await expect(prepareAdminPreviewAssets(repo, [...files, { relativePath: "extra.txt", bytes: Buffer.from("safe") }])).rejects.toThrow("artifact_policy_failed");
    expect(existsSync(packagePath(repo))).toBe(false);
  });

  it("rejects an empty admin directory and a linked fixture ancestor", async () => {
    const repo = previewRepo();
    const staging = writeStaging(repo);
    const admin = path.join(staging, "site/admin");
    mkdirSync(admin);
    expect((await packageAdminPreview({ repoRoot: repo, stagingDir: staging, packageDir: packagePath(repo) })).ok).toBe(false);
    rmSync(admin, { recursive: true });
    const fixtureRoot = path.join(repo, "fixtures/cloudflare-admin-assets");
    rmSync(fixtureRoot, { recursive: true });
    junction(fixtureRoot, path.join(worktree, "fixtures/cloudflare-admin-assets"));
    try {
      expect((await packageAdminPreview({ repoRoot: repo, stagingDir: staging, packageDir: packagePath(repo) })).ok).toBe(false);
      expect(existsSync(packagePath(repo))).toBe(false);
    } finally { rmSync(fixtureRoot); }
  });

  it("rejects a linked staging root before inspecting reports", async () => {
    const repo = previewRepo();
    const staging = writeStaging(repo);
    const alias = path.join(repo, "dist/staging/alias");
    junction(alias, staging);
    try {
      expect((await packageAdminPreview({ repoRoot: repo, stagingDir: alias, packageDir: packagePath(repo) })).ok).toBe(false);
      expect(existsSync(packagePath(repo))).toBe(false);
    } finally { rmSync(alias); }
  });

  it("adds only approved admin HTML and never grants release readiness", async () => {
    const repo = previewRepo();
    const staging = writeStaging(repo);
    const output = packagePath(repo, "admin-preview");
    const result = await packageAdminPreview({ repoRoot: repo, stagingDir: staging, packageDir: output });
    expect(result).toMatchObject({ ok: true, ready: false, previewReady: true, productionReady: false });
    const manifest = JSON.parse(readFileSync(path.join(output, "package-manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ kind: "admin-preview", ready: false, previewReady: true, productionReady: false });
    expect(manifest.inventory.files.some((file: { path: string }) => file.path === "site/admin/login.html")).toBe(true);
    expect(manifest.inventory.files.some((file: { path: string }) => file.path === "package-manifest.json")).toBe(false);
    expect(manifest.requiredBindings).toContain("ADMIN_COOKIE_HMAC_KEY");
    expect(manifest.requiredBindings).toContain("ADMIN_CRYPTO_KEY");
    expect(manifest.requiredBindings).toContain("PUBLICATION_ID");
    expect(manifest.requiredBindings).toContain("PUBLICATION_CAPABILITY");
    expect(manifest.requiredBindings).not.toContain("ADMIN_AUTH_EMAIL");
    expect(manifest.requiredBindings).not.toContain("ADMIN_AUTH_USER_ID");
    expect(manifest.optionalBindings).toContain("ADMIN_PASSWORD");
    const config = JSON.parse(readFileSync(path.join(output, "wrangler.jsonc"), "utf8"));
    expect(config.assets.binding).toBe("ASSETS");
    expect(config.assets.run_worker_first).toEqual(["/api/*", "/product/*", "/admin", "/admin/*"]);
    expect(config.vars).toBeUndefined();
    expect(readFileSync(path.join(output, "site/admin/login.html"), "utf8")).toContain('action="/api/admin/login"');
    expect(readFileSync(path.join(output, "site/admin/security.html"), "utf8")).toContain('action="/api/admin/password"');
    expect(existsSync(path.join(staging, "site/admin"))).toBe(false);
    expect(existsSync(path.join(repo, "dist/site"))).toBe(false);
  }, 90_000);

  it.each(["admin.html", "admin/index.html", "Admin/login.html"])("rejects staged admin route collision %s before writing", async (name) => {
    const repo = previewRepo();
    const staging = writeStaging(repo, { siteFiles: { "index.html": "public", [name]: "unapproved" } });
    const output = packagePath(repo);
    expect(await packageAdminPreview({ repoRoot: repo, stagingDir: staging, packageDir: output })).toMatchObject({ ok: false, ready: false });
    expect(existsSync(output)).toBe(false);
  });

  it("rejects an untracked or secret-bearing fixture before writing", async () => {
    const repo = previewRepo();
    const staging = writeStaging(repo);
    const fixture = path.join(repo, "fixtures/cloudflare-admin-assets/admin/login.html");
    writeFileSync(fixture, "sb_secret_never_echo_this");
    const output = packagePath(repo);
    const result = await packageAdminPreview({ repoRoot: repo, stagingDir: staging, packageDir: output });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("never_echo_this");
    expect(existsSync(output)).toBe(false);
    expect(spawnSync("git", ["rm", "--cached", "-f", "--", "fixtures/cloudflare-admin-assets/admin/login.html"], { cwd: repo, windowsHide: true }).status).toBe(0);
    writeFileSync(fixture, "<h1>Untracked</h1>");
    expect((await packageAdminPreview({ repoRoot: repo, stagingDir: staging, packageDir: output })).ok).toBe(false);
    expect(existsSync(output)).toBe(false);
  });
});

function junction(link: string, target: string) {
  const result = spawnSync("cmd", ["/c", "mklink", "/J", link, target], { windowsHide: true, encoding: "utf8" });
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

describe("local worker package", () => {
  it("records a pinned release identity and digest without serializing its capability", async () => {
    const repo = makeRepo();
    const staging = writeStaging(repo);
    const output = packagePath(repo, "pinned-identity");
    const result = await packageWorkerAssets({ repoRoot: repo, stagingDir: staging, packageDir: output,
      pinnedRelease: { id: "20000000-0000-4000-8000-000000000001", revision: 7,
        sha256: "a".repeat(64) } });
    expect(result).toMatchObject({ ok: true, ready: true, productionReady: false,
      release: { id: "20000000-0000-4000-8000-000000000001", revision: 7, sha256: "a".repeat(64) } });
    const manifest = readFileSync(path.join(output, "package-manifest.json"), "utf8");
    expect(manifest).not.toContain("capability");
    expect(verifyPackageIntegrity(output)).toEqual({ ok: true });
  });

  it("rejects mismatched or malformed pinned metadata before creating a package", async () => {
    for (const [name, pinnedRelease] of [
      ["revision", { id: "20000000-0000-4000-8000-000000000001", revision: 8, sha256: "a".repeat(64) }],
      ["digest", { id: "20000000-0000-4000-8000-000000000001", revision: 7, sha256: "bad" }],
      ["identity", { id: "not-a-uuid", revision: 7, sha256: "a".repeat(64) }],
      ["secret", { id: "20000000-0000-4000-8000-000000000001", revision: 7,
        sha256: "a".repeat(64), capability: "must-never-be-serialized" }],
    ] as const) {
      const repo = makeRepo();
      const staging = writeStaging(repo);
      const output = packagePath(repo, `invalid-${name}`);
      const result = await packageWorkerAssets({ repoRoot: repo, stagingDir: staging, packageDir: output,
        pinnedRelease });
      expect(result).toMatchObject({ ok: false, ready: false, code: "pinned_release_invalid" });
      expect(existsSync(output)).toBe(false);
    }
  });

  it("refuses browser verification before launch when bindings disagree with the sealed release", async () => {
    const repo = makeRepo();
    const staging = writeStaging(repo);
    const output = packagePath(repo, "pinned-runtime-mismatch");
    const releaseId = "20000000-0000-4000-8000-000000000001";
    const releaseSha256 = "a".repeat(64);
    const result = await packageWorkerAssets({ repoRoot: repo, stagingDir: staging, packageDir: output,
      pinnedRelease: { id: releaseId, revision: 7, sha256: releaseSha256 } });
    expect(result.ready).toBe(true);
    const baseline = { packageDir: output, supabaseUrl: "http://127.0.0.1:54321",
      publishableKey: "sb_publishable_fixture", publicationId: releaseId,
      publicationCapability: "fixture-capability-long-enough-for-the-probe",
      browserProbe: { query: "val", expectedName: "Вал", expectedSlug: "shaft",
        productPath: "/catalog/category/pto/shaft" } };
    await expect(verifyPackagedWorker({ ...baseline, publicationSha256: "b".repeat(64) }))
      .rejects.toThrow("packaged_release_mismatch");
    await expect(verifyPackagedWorker({ ...baseline, publicationId: "20000000-0000-4000-8000-000000000002",
      publicationSha256: releaseSha256 })).rejects.toThrow("packaged_release_mismatch");
    expect(verifyPackageIntegrity(output)).toEqual({ ok: true });
  });
  it("refuses a stale catalog revision before creating a public package", async () => {
    const repo = makeRepo({ createPackageArea: false });
    const staging = writeStaging(repo);
    writeFileSync(path.join(staging, "meta", "publication-revision-report.json"), JSON.stringify({ schemaVersion: 1, ok: true, revision: 7 }));
    const output = packagePath(repo, "stale");
    const result = await packageWorkerAssets({ repoRoot: repo, stagingDir: staging, packageDir: output, readCurrentRevision: async () => 8 });
    expect(result).toMatchObject({ ok: false, ready: false, code: "publication_revision_changed" });
    expect(existsSync(path.join(repo, "dist", "worker-packages"))).toBe(false);
  });

  it("refuses missing revision evidence even when the ordinary reports pass", async () => {
    const repo = makeRepo({ createPackageArea: false });
    const staging = writeStaging(repo);
    rmSync(path.join(staging, "meta", "publication-revision-report.json"));
    const result = await packageWorkerAssets({
      repoRoot: repo, stagingDir: staging, packageDir: packagePath(repo, "missing-revision"), readCurrentRevision: async () => 7,
    });
    expect(result).toMatchObject({ ok: false, ready: false, code: "publication_revision_unavailable" });
    expect(existsSync(path.join(repo, "dist", "worker-packages"))).toBe(false);
  });

  it("refuses a public package when no current-revision reader was supplied", async () => {
    const repo = makeRepo({ createPackageArea: false });
    const staging = writeStaging(repo);
    const result = await packageWorkerAssetsReal({ repoRoot: repo, stagingDir: staging, packageDir: packagePath(repo, "no-reader") });
    expect(result).toMatchObject({ ok: false, ready: false, code: "publication_revision_unavailable" });
    expect(existsSync(path.join(repo, "dist", "worker-packages"))).toBe(false);
  });

  it("refuses an unavailable current revision and never echoes its error", async () => {
    const repo = makeRepo({ createPackageArea: false });
    const staging = writeStaging(repo);
    writeFileSync(path.join(staging, "meta", "publication-revision-report.json"), JSON.stringify({ schemaVersion: 1, ok: true, revision: 7 }));
    const result = await packageWorkerAssets({
      repoRoot: repo, stagingDir: staging, packageDir: packagePath(repo, "outage"),
      readCurrentRevision: async () => { throw new Error("backend-secret"); },
    });
    expect(result).toMatchObject({ ok: false, ready: false, code: "publication_revision_unavailable" });
    expect(JSON.stringify(result)).not.toContain("backend-secret");
    expect(existsSync(path.join(repo, "dist", "worker-packages"))).toBe(false);
  });

  it("records a stable revision in the public package without claiming production readiness", async () => {
    const repo = makeRepo();
    const staging = writeStaging(repo);
    writeFileSync(path.join(staging, "meta", "publication-revision-report.json"), JSON.stringify({ schemaVersion: 1, ok: true, revision: 7 }));
    const output = packagePath(repo, "stable-revision");
    const result = await packageWorkerAssets({ repoRoot: repo, stagingDir: staging, packageDir: output, readCurrentRevision: async () => 7 });
    expect(result).toMatchObject({ ok: true, ready: true, productionReady: false });
    const manifest = JSON.parse(readFileSync(path.join(output, "package-manifest.json"), "utf8"));
    expect(manifest.sourceRevision).toBe(7);
    expect(JSON.parse(readFileSync(path.join(output, "source-revision.json"), "utf8"))).toEqual({ schemaVersion: 1, revision: 7 });
    expect(manifest.inventory.files.some((file: { path: string }) => file.path === "source-revision.json")).toBe(true);
    expect(manifest.productionReady).toBe(false);
  }, 20_000);

  it("refuses a revision change during packaging before writing a ready manifest", async () => {
    const repo = makeRepo();
    const staging = writeStaging(repo);
    writeFileSync(path.join(staging, "meta", "publication-revision-report.json"), JSON.stringify({ schemaVersion: 1, ok: true, revision: 7 }));
    let reads = 0;
    const output = packagePath(repo, "changed-during-package");
    const result = await packageWorkerAssets({
      repoRoot: repo, stagingDir: staging, packageDir: output,
      readCurrentRevision: async () => (++reads === 1 ? 7 : 8),
    });
    expect(result).toMatchObject({ ok: false, ready: false, code: "publication_revision_changed" });
    expect(existsSync(path.join(output, "package-manifest.json"))).toBe(false);
  }, 20_000);

  it("creates its package area for a verified staging run in a fresh repo", async () => {
    const repo = makeRepo({ createPackageArea: false });
    const staging = writeStaging(repo);
    const output = packagePath(repo, "first-package");
    const result = await packageWorkerAssets({ repoRoot: repo, stagingDir: staging, packageDir: output });
    expect(result).toMatchObject({ ok: true, ready: true });
    expect(existsSync(path.join(output, "package-manifest.json"))).toBe(true);
  }, 20_000); // Includes a real local Wrangler dry-run, which can exceed Vitest's 5 s default under full-suite load.

  it("does not create its package area for an unverified staging run", async () => {
    const repo = makeRepo({ createPackageArea: false });
    const staging = writeStaging(repo, { reports: false });
    const output = packagePath(repo, "rejected-package");
    const result = await packageWorkerAssets({ repoRoot: repo, stagingDir: staging, packageDir: output });
    expect(result).toMatchObject({ ok: false, ready: false });
    expect(existsSync(path.join(repo, "dist", "worker-packages"))).toBe(false);
  });

  it("bundles a self-contained worker and keeps maps and meta out of site", async () => {
    const repo = makeRepo();
    const staging = writeStaging(repo);
    const output = packagePath(repo);
    const result = await packageWorkerAssets({ repoRoot: repo, stagingDir: staging, packageDir: output });
    expect(result).toMatchObject({ ok: true, ready: true });
    const worker = readFileSync(path.join(output, "worker.js"), "utf8");
    const config = readFileSync(path.join(output, "wrangler.jsonc"), "utf8");
    const manifest = JSON.parse(readFileSync(path.join(output, "package-manifest.json"), "utf8"));
    expect(worker).not.toMatch(/^\s*import\s/m);
    expect(worker).not.toMatch(/from\s+["'][^"']*src\/cloudflare/);
    expect(worker).not.toContain("sourceMappingURL");
    expect(worker).not.toContain("service_role");
    expect(config).toContain('"main": "worker.js"');
    expect(config).toContain('"directory": "site"');
    expect(config).not.toContain("alias-worker-entry");
    expect(manifest.ready).toBe(true);
    expect(result.productionReady).toBe(false);
    expect(manifest.productionReady).toBe(false);
    expect(manifest.requiredBindings).toEqual([
      "ASSETS", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "PUBLICATION_ID", "PUBLICATION_CAPABILITY",
    ]);
    expect(JSON.stringify(manifest)).not.toContain("local-packaged-worker-capability-fixture-2026");
    expect(manifest.inventory.files.map((file: { path: string }) => file.path)).toContain("worker.js");
    expect(manifest.inventory.files.some((file: { path: string }) => file.path.startsWith("site/"))).toBe(true);
    expect(manifest.inventory.files.some((file: { path: string }) => file.path === "package-manifest.json")).toBe(false);
    expect(manifest.worker.rawBytes).toBe(Buffer.byteLength(worker));
    expect(manifest.worker.gzipBytes).toBeGreaterThan(0);
    expect(manifest.worker.gzipBytes).toBeLessThan(manifest.worker.rawBytes);
    const loaded = await import(pathToFileURL(path.join(output, "worker.js")).href);
    const response = await loaded.default.fetch(new Request("https://www.ayprom-gidravlika.kg/product/shaft"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://www.ayprom-gidravlika.kg/catalog/category/pto/shaft");
    expect(readFileSync(path.join(output, "site", "index.html"), "utf8")).toContain("AYPROM");
    expect(existsSync(path.join(output, "site", "meta"))).toBe(false);
    expect(existsSync(path.join(output, "site", "app.js.map"))).toBe(false);
  });

  it("leaves an existing package directory and its marker untouched", async () => {
    const repo = makeRepo();
    const staging = writeStaging(repo);
    const output = packagePath(repo, "existing");
    mkdirSync(output, { recursive: true });
    const marker = path.join(output, "marker.txt");
    writeFileSync(marker, "keep-me");
    const result = await packageWorkerAssets({ repoRoot: repo, stagingDir: staging, packageDir: output });
    expect(result).toMatchObject({ ok: false, ready: false, code: "package_path_rejected" });
    expect(readFileSync(marker, "utf8")).toBe("keep-me");
    expect(existsSync(path.join(output, "package-manifest.json"))).toBe(false);
  });

  it("rejects a package path that escapes through a junction", async () => {
    const repo = makeRepo();
    const outside = tempDir();
    const marker = path.join(outside, "marker.txt");
    writeFileSync(marker, "outside");
    rmSync(path.join(repo, "dist", "worker-packages"), { recursive: true, force: true });
    junction(path.join(repo, "dist", "worker-packages"), outside);
    const result = await packageWorkerAssets({
      repoRoot: repo,
      stagingDir: writeStaging(repo),
      packageDir: packagePath(repo, "escaped"),
    });
    expect(result).toMatchObject({ ok: false, ready: false, code: "package_path_rejected" });
    expect(readFileSync(marker, "utf8")).toBe("outside");
    expect(existsSync(path.join(outside, "escaped"))).toBe(false);
  });

  it("rejects the repo root, dist/site, the staging dir, and a directory outside dist", async () => {
    const repo = makeRepo();
    const staging = writeStaging(repo);
    const site = path.join(repo, "dist", "site");
    mkdirSync(site, { recursive: true });
    writeFileSync(path.join(site, "marker.txt"), "site");
    const outside = tempDir();
    writeFileSync(path.join(outside, "marker.txt"), "outside");
    for (const packageDir of [repo, site, staging, outside]) {
      const result = await packageWorkerAssets({ repoRoot: repo, stagingDir: staging, packageDir });
      expect(result).toMatchObject({ ok: false, ready: false, code: "package_path_rejected" });
    }
    expect(readFileSync(path.join(site, "marker.txt"), "utf8")).toBe("site");
    expect(readFileSync(path.join(outside, "marker.txt"), "utf8")).toBe("outside");
    expect(existsSync(path.join(site, "worker.js"))).toBe(false);
  });

  it("does not declare a package ready when a verification report is missing or negative", async () => {
    const repo = makeRepo();
    const missing = writeStaging(repo, { reports: false });
    const missingOutput = packagePath(repo, "missing-reports");
    const missingResult = await packageWorkerAssets({ repoRoot: repo, stagingDir: missing, packageDir: missingOutput });
    expect(missingResult).toMatchObject({ ok: false, ready: false, code: "staging_not_verified" });
    expect(existsSync(missingOutput)).toBe(false);

    const negative = writeStaging(repo, { crawl: { summary: { failed: 1, written: 2, routes: 3 } } });
    const negativeOutput = packagePath(repo, "negative-reports");
    const negativeResult = await packageWorkerAssets({ repoRoot: repo, stagingDir: negative, packageDir: negativeOutput });
    expect(negativeResult).toMatchObject({ ok: false, ready: false, code: "staging_not_verified" });
    expect(existsSync(negativeOutput)).toBe(false);
  });

  it("does not declare a package ready when staging content is unsafe", async () => {
    const repo = makeRepo();
    const staging = writeStaging(repo, {
      siteFiles: {
        "index.html": "<p>sb_secret_do_not_echo</p>",
        "app.js.map": "{\"sources\":[\"secret\"]}",
      },
    });
    const output = packagePath(repo, "unsafe");
    const result = await packageWorkerAssets({ repoRoot: repo, stagingDir: staging, packageDir: output });
    expect(result.ok).toBe(false);
    expect(result.ready).toBe(false);
    expect(JSON.stringify(result)).not.toContain("sb_secret_do_not_echo");
    expect(existsSync(path.join(output, "package-manifest.json"))).toBe(false);
    expect(existsSync(path.join(output, "site", "app.js.map"))).toBe(false);
  });

  it("rejects source maps regardless of filename case before creating a package", async () => {
    const repo = makeRepo();
    const staging = writeStaging(repo, {
      siteFiles: {
        "index.html": "<h1>AYPROM</h1>",
        "bundle.MAP": "{\"sources\":[\"private.ts\"]}",
      },
    });
    const output = packagePath(repo, "upper-case-map");
    const result = await packageWorkerAssets({ repoRoot: repo, stagingDir: staging, packageDir: output });
    expect(result).toMatchObject({ ok: false, ready: false, code: "invalid_staging" });
    expect(existsSync(output)).toBe(false);
  });

  it("rejects environment files regardless of filename case before creating a package", async () => {
    const repo = makeRepo();
    const staging = writeStaging(repo, {
      siteFiles: {
        "index.html": "<h1>AYPROM</h1>",
        "config/.ENV": "private-value=do-not-package",
      },
    });
    const output = packagePath(repo, "upper-case-env");
    const result = await packageWorkerAssets({ repoRoot: repo, stagingDir: staging, packageDir: output });
    expect(result).toMatchObject({ ok: false, ready: false, code: "invalid_staging" });
    expect(existsSync(output)).toBe(false);
  });

  it("serves health, search and a product alias on local workerd", async () => {
    const publicationId = "20000000-0000-4000-8000-000000000001";
    const publicationCapability = "local-packaged-worker-capability-fixture-2026";
    const repo = makeRepo();
    const staging = writeStaging(repo);
    const output = packagePath(repo, "runtime");
    const result = await packageWorkerAssets({ repoRoot: repo, stagingDir: staging, packageDir: output });
    expect(result.ready, JSON.stringify(result)).toBe(true);
    const mock = http.createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (body.search_query !== "val" || body.publication_id !== publicationId
        || body.publication_capability !== publicationCapability) {
        response.writeHead(400);
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json",
        "content-range": "0-0/1",
      });
      response.end(JSON.stringify([{
        slug: "shaft",
        name: "Вал",
        category_slug: "pto",
        subcategory_slug: null,
        short_description: "Вал",
        article: null,
        cover_url: null,
        cover_fallback_url: null,
        cover_scale: null,
        compatible_brands: [],
      }]));
    });
    await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
    const address = mock.address();
    if (!address || typeof address === "string") throw new Error("mock_port");
    try {
      const checks = await verifyPackagedWorker({
        packageDir: output,
        supabaseUrl: `http://127.0.0.1:${address.port}`,
        publishableKey: "sb_publishable_local_worker_package_test",
        publicationId, publicationCapability,
        searchQuery: "val",
        aliasPath: "/product/cog",
        staticPath: "/catalog/category/pto/shaft",
      });
      expect(checks).toMatchObject({
        health: { status: 200 },
        search: { status: 200, slug: "shaft" },
        alias: { status: 308, location: "/catalog/category/pto/cog" },
        static: { status: 200 },
      });
      expect(checks.static.contentType).toMatch(/^text\/html/);
      expect(JSON.stringify(checks)).not.toContain("sb_publishable_local_worker_package_test");
      expect(JSON.stringify(checks)).not.toContain(publicationCapability);
      expect(verifyPackageIntegrity(output)).toEqual({ ok: true });
    } finally {
      await new Promise<void>((resolve) => mock.close(() => resolve()));
    }
  }, 90_000);
});
