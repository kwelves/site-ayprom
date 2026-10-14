import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { derivePublicRoutes, type CatalogRouteSource } from "@/cloudflare/static-build/derive-routes";
import type { StaticBuildPreflightInput } from "@/cloudflare/static-build/preflight";
import type { ChildServerSpec, StaticProducerInput } from "@/cloudflare/static-build/producer/types";

export const SITE_URL = "https://www.ayprom-gidravlika.kg";
export const FIXTURE_SERVER = path.resolve("scripts/cloudflare/static-producer-fixture-server.mjs");

// Temporary repository root with a pre-existing dist/site that must survive
// every producer run untouched.
export function makeTempRepo(): { repoRoot: string; stagingRoot: string; siteSnapshot: () => Record<string, string> } {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "ayprom-static-producer-"));
  const previousSite = path.join(repoRoot, "dist", "site");
  mkdirSync(path.join(previousSite, "catalog"), { recursive: true });
  writeFileSync(path.join(previousSite, "index.html"), "<!doctype html><title>previous</title>");
  writeFileSync(path.join(previousSite, "catalog.html"), "<!doctype html><title>previous catalog</title>");
  writeFileSync(path.join(previousSite, "catalog", "brand.html"), "<!doctype html><title>previous brand</title>");
  return {
    repoRoot,
    stagingRoot: path.join(repoRoot, "dist", "staging"),
    siteSnapshot: () => snapshotTree(previousSite),
  };
}

export function removeTempRepo(repoRoot: string) {
  rmSync(repoRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

export function snapshotTree(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else result[path.relative(root, absolute).replaceAll("\\", "/")] = sha256(readFileSync(absolute));
    }
  };
  if (statSync(root, { throwIfNoEntry: false })?.isDirectory()) walk(root);
  return result;
}

export function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function fixturePreflight(repoRoot: string, stagingRoot: string): StaticBuildPreflightInput {
  return {
    sourceMode: "fixture",
    release: false,
    repoRoot,
    outputRoot: stagingRoot,
    gitSha: "d6bdc4586786f01a843a657e266488bbbfc35d82",
    hasTrackedChanges: true,
    requestedPort: null,
    requestedPortAvailable: true,
    env: {
      AYPROM_STATIC_BUILD: "1",
      NEXT_PUBLIC_SITE_URL: SITE_URL,
      NEXT_PUBLIC_MEDIA_BASE_URL: "https://media.ayprom-gidravlika.kg",
      NEXT_PUBLIC_HERO_MEDIA_SOURCE: "r2",
    },
  };
}

// Brand + direct categories only: no subcategory-type category, so the
// derived route set carries no mixed-category blocker.
export function fixtureRouteSource(): CatalogRouteSource {
  return {
    snapshotId: "producer-fixture",
    categories: [
      { slug: "fittings", type: null },
      { slug: "pto", type: "brand" },
    ],
    subcategories: [],
    brands: [{ slug: "kamaz" }, { slug: "shacman" }],
    vehicleTypes: [{ slug: "truck" }],
    categoryBrands: { pto: ["shacman", "kamaz"] },
    directProductCategorySlugs: ["fittings"],
    products: [
      {
        slug: "seal", name: "Уплотнение", category: "fittings", compatibleBrands: [],
        images: [{ url: "https://media.ayprom-gidravlika.kg/seal.webp" }], shortDescription: "Уплотнение",
        updatedAt: "2026-09-22T10:00:00Z",
      },
      {
        slug: "shaft", name: "Вал", category: "pto", compatibleBrands: ["shacman", "kamaz"],
        images: [], shortDescription: "Вал", updatedAt: "2026-09-22T11:00:00Z",
      },
    ],
  };
}

export function fixtureRoutes() {
  return derivePublicRoutes(fixtureRouteSource(), SITE_URL);
}

export function fixtureServerSpec(extraArgs: string[] = []): StaticProducerInput["server"] {
  return ({ routeManifestPath, sitemapPathsPath }): ChildServerSpec => ({
    command: process.execPath,
    args: [FIXTURE_SERVER, "--manifest", routeManifestPath, "--sitemap", sitemapPathsPath, "--site-url", SITE_URL, ...extraArgs],
    cwd: process.cwd(),
    readyPattern: /Ready on (http:\/\/127\.0\.0\.1:\d+)/,
  });
}

export function fixtureProducerInput(
  repo: { repoRoot: string; stagingRoot: string },
  overrides: Partial<StaticProducerInput> = {},
  serverArgs: string[] = [],
): StaticProducerInput {
  const { manifestEntries, sitemapEntries, blockers } = fixtureRoutes();
  return {
    preflight: fixturePreflight(repo.repoRoot, repo.stagingRoot),
    snapshotId: "producer-fixture",
    entries: manifestEntries,
    blockers,
    sitemapPaths: sitemapEntries.map((entry) => entry.path),
    server: fixtureServerSpec(serverArgs),
    limits: { launchTimeoutMs: 15_000, requestTimeoutMs: 5_000, stopTimeoutMs: 10_000, totalTimeoutMs: 60_000 },
    ...overrides,
  };
}

export function listStagingDirs(stagingRoot: string): string[] {
  return statSync(stagingRoot, { throwIfNoEntry: false })?.isDirectory()
    ? readdirSync(stagingRoot).sort()
    : [];
}
