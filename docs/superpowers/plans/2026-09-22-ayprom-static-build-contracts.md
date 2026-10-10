# AYPROM Static Build Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, framework-neutral contracts that reject unsafe crawl-and-freeze inputs before any Next.js process starts or any file is written.

**Architecture:** Add a small `src/cloudflare/static-build/` domain with five dependency-free core TypeScript modules plus an explicit export surface: shared validation results, build preflight, catalog snapshot validation, deterministic route-manifest primitives, and artifact policy. This slice performs no crawling, Supabase access, process spawning, output promotion, Wrangler change, or production mutation; downstream slices consume these contracts.

**Tech Stack:** TypeScript 5, Vitest 4, Node.js `path`/`Buffer` APIs, existing npm scripts, Cloudflare Workers Static Assets limits.

**Spec:** `docs/superpowers/specs/2026-09-21-ayprom-crawl-and-freeze-design.md`

## Global Constraints

- Keep Next/Vercel unchanged as the legacy adapter and rollback origin.
- Keep `wrangler.static-assets.jsonc` pointed at `fixtures/cloudflare-static-assets` throughout this slice.
- Do not add an `ASSETS` binding, Worker-first public routes, admin/auth work, product redirects, or client search code.
- Do not access production Supabase, Cloudflare, R2, Vercel, or DNS; do not push or deploy.
- Public catalog inputs may contain only a publishable Supabase key; reject `service_role`, `sb_secret_*`, and JWTs whose payload role is `service_role`.
- A releasable build uses site origin `https://www.ayprom-gidravlika.kg`, media origin `https://media.ayprom-gidravlika.kg`, and hero source `r2`.
- Local snapshot mode accepts only `http://localhost:54321` or `http://127.0.0.1:54321` as the Supabase origin.
- `dist/` is ignored and is the only permitted output root; no implementation in this slice writes to it.
- Cloudflare Workers Free permits at most 20,000 static files and 25 MiB per file; emit a warning from 15,000 files onward. Source: `https://developers.cloudflare.com/workers/platform/limits/`.
- Preserve the protected untracked `.codex/`, `debug.log`, and `docs/CLOUDFLARE_FREE_HOSTING_MIGRATION_PLAN.md` paths.
- Use RED/GREEN TDD and commit only the files listed in each task.

## Review Focus

- Windows containment: `C:\repo\dist-escape` and mixed-slash paths must not be mistaken for children of `C:\repo\dist`; Task 1 pins both cases.
- Secret safety: malformed JWTs and rejected keys must produce field/rule codes without echoing the original value; Task 1 pins the returned issues and serialized result.
- Snapshot integrity: duplicate slugs and references to missing categories, subcategories, brands, or vehicle types must fail before route derivation; Task 2 pins every relation.
- Route ambiguity: query strings, fragments, traversal segments, trailing slashes, duplicate normalized paths, and case-insensitive output collisions must be rejected deterministically; Task 3 pins each class.
- Artifact bypasses: backslashes, uppercase extensions, percent-encoded path escapes, case collisions, and mixed-case secret markers must not evade path/content policy; Task 4 pins normalized matching and per-file scanning.

---

## File Structure

- Create `src/cloudflare/static-build/validation.ts`: stable failure/issue/result types shared by all pure validators.
- Create `src/cloudflare/static-build/preflight.ts`: environment, key, Git-state, and output-containment validation.
- Create `src/cloudflare/static-build/snapshot.ts`: frozen catalog snapshot types and referential-integrity validation.
- Create `src/cloudflare/static-build/route-manifest.ts`: route entry union, path-to-file mapping, collision checks, stable sorting, and deterministic serialization.
- Create `src/cloudflare/static-build/artifact-policy.ts`: file-count, size, path, collision, and textual-secret policy.
- Create `src/cloudflare/static-build/index.ts`: explicit public exports for downstream builder slices.
- Create `tests/cloudflare-static-build-preflight.test.ts`: preflight RED/GREEN coverage.
- Create `tests/cloudflare-static-build-snapshot.test.ts`: snapshot RED/GREEN coverage.
- Create `tests/cloudflare-static-build-route-manifest.test.ts`: route primitive RED/GREEN coverage.
- Create `tests/cloudflare-static-build-artifact-policy.test.ts`: artifact policy RED/GREEN coverage.
- Modify `.gitignore`: add `/dist/` before the producer slice is allowed to write artifacts.
- Modify `package.json`: add one focused aggregate contract-test command after all four suites exist.

### Task 1: Stable Validation Result and Build Preflight

**Files:**
- Create: `src/cloudflare/static-build/validation.ts`
- Create: `src/cloudflare/static-build/preflight.ts`
- Create: `tests/cloudflare-static-build-preflight.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: caller-supplied environment values and already-measured Git/port facts; it performs no filesystem, Git, network, or socket access.
- Produces: `ValidationResult<T>`, `StaticBuildIssue`, `validateStaticBuildPreflight(input)`, and `StaticBuildPreflight` for process-runner code in slice 3.

- [ ] **Step 1: Write the failing validation/preflight tests**

Create the test with a valid baseline and table-driven mutations:

```ts
import { describe, expect, it } from "vitest";
import {
  validateStaticBuildPreflight,
  type StaticBuildPreflightInput,
} from "@/cloudflare/static-build/preflight";

const validInput = (): StaticBuildPreflightInput => ({
  sourceMode: "local-snapshot",
  release: true,
  repoRoot: "C:\\repo",
  outputRoot: "C:\\repo\\dist\\site",
  gitSha: "ec933e0",
  hasTrackedChanges: false,
  requestedPort: null,
  requestedPortAvailable: true,
  env: {
    AYPROM_STATIC_BUILD: "1",
    NEXT_PUBLIC_SITE_URL: "https://www.ayprom-gidravlika.kg",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
    NEXT_PUBLIC_MEDIA_BASE_URL: "https://media.ayprom-gidravlika.kg",
    NEXT_PUBLIC_HERO_MEDIA_SOURCE: "r2",
  },
});

describe("static build preflight", () => {
  it("accepts the exact releasable local-snapshot boundary", () => {
    expect(validateStaticBuildPreflight(validInput())).toEqual({
      ok: true,
      value: expect.objectContaining({
        sourceMode: "local-snapshot",
        siteOrigin: "https://www.ayprom-gidravlika.kg",
        mediaOrigin: "https://media.ayprom-gidravlika.kg",
        supabaseOrigin: "http://127.0.0.1:54321",
        outputRoot: "C:\\repo\\dist\\site",
      }),
    });
  });

  it.each([
    ["static flag", (input: StaticBuildPreflightInput) => { input.env.AYPROM_STATIC_BUILD = "0"; }, "AYPROM_STATIC_BUILD", "must_equal_1"],
    ["site origin", (input: StaticBuildPreflightInput) => { input.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3001"; }, "NEXT_PUBLIC_SITE_URL", "release_origin_mismatch"],
    ["media origin", (input: StaticBuildPreflightInput) => { input.env.NEXT_PUBLIC_MEDIA_BASE_URL = "https://example.r2.dev"; }, "NEXT_PUBLIC_MEDIA_BASE_URL", "release_origin_mismatch"],
    ["hero source", (input: StaticBuildPreflightInput) => { input.env.NEXT_PUBLIC_HERO_MEDIA_SOURCE = "supabase"; }, "NEXT_PUBLIC_HERO_MEDIA_SOURCE", "must_equal_r2"],
    ["remote Supabase", (input: StaticBuildPreflightInput) => { input.env.NEXT_PUBLIC_SUPABASE_URL = "https://prod.supabase.co"; }, "NEXT_PUBLIC_SUPABASE_URL", "local_snapshot_requires_loopback"],
    ["secret key", (input: StaticBuildPreflightInput) => { input.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_secret_do_not_echo"; }, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "secret_key_forbidden"],
    ["tracked changes", (input: StaticBuildPreflightInput) => { input.hasTrackedChanges = true; }, "git", "tracked_changes_forbidden"],
    ["bad SHA", (input: StaticBuildPreflightInput) => { input.gitSha = "not-a-sha"; }, "gitSha", "invalid_sha"],
    ["occupied port", (input: StaticBuildPreflightInput) => { input.requestedPort = 3001; input.requestedPortAvailable = false; }, "requestedPort", "port_unavailable"],
  ])("rejects %s without exposing values", (_name, mutate, field, rule) => {
    const input = validInput();
    mutate(input);
    const result = validateStaticBuildPreflight(input);

    expect(result).toEqual({
      ok: false,
      code: "preflight_failed",
      issues: expect.arrayContaining([{ field, rule }]),
    });
    expect(JSON.stringify(result)).not.toContain("do_not_echo");
  });

  it.each([
    "C:\\repo\\dist-escape\\site",
    "C:/repo/elsewhere/site",
    "C:\\repo\\dist\\..\\outside",
  ])("rejects output outside the real dist boundary: %s", (outputRoot) => {
    const input = validInput();
    input.outputRoot = outputRoot;
    expect(validateStaticBuildPreflight(input)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([{ field: "outputRoot", rule: "outside_dist" }]),
    });
  });

  it("rejects service_role encoded inside a Supabase JWT", () => {
    const input = validInput();
    const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    input.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = `x.${payload}.y`;
    expect(validateStaticBuildPreflight(input)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        { field: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", rule: "service_role_forbidden" },
      ]),
    });
  });

  it("rejects a malformed JWT-shaped key without throwing or echoing it", () => {
    const input = validInput();
    input.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "header.not-base64!.signature";
    const result = validateStaticBuildPreflight(input);
    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        { field: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", rule: "invalid_publishable_key" },
      ]),
    });
    expect(JSON.stringify(result)).not.toContain("not-base64");
  });

  it("rejects revisioned-live until revision support exists", () => {
    const input = validInput();
    input.sourceMode = "revisioned-live";
    expect(validateStaticBuildPreflight(input)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([{ field: "sourceMode", rule: "live_mode_disabled" }]),
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test -- tests/cloudflare-static-build-preflight.test.ts`

Expected: FAIL because `@/cloudflare/static-build/preflight` does not exist.

- [ ] **Step 3: Implement the minimal shared result and preflight contracts**

Use these exact public shapes in `validation.ts`:

```ts
export type StaticBuildFailureCode =
  | "preflight_failed"
  | "snapshot_invalid"
  | "route_manifest_incomplete"
  | "artifact_policy_failed";

export interface StaticBuildIssue {
  field: string;
  rule: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: StaticBuildFailureCode; issues: StaticBuildIssue[] };
```

Use these exact preflight types in `preflight.ts`:

```ts
export type StaticBuildSourceMode = "fixture" | "local-snapshot" | "revisioned-live";

export interface StaticBuildPreflightInput {
  sourceMode: StaticBuildSourceMode;
  release: boolean;
  repoRoot: string;
  outputRoot: string;
  gitSha: string;
  hasTrackedChanges: boolean;
  requestedPort: number | null;
  requestedPortAvailable: boolean;
  env: Record<string, string | undefined>;
}

export interface StaticBuildPreflight {
  sourceMode: "fixture" | "local-snapshot";
  release: boolean;
  repoRoot: string;
  outputRoot: string;
  gitSha: string;
  requestedPort: number | null;
  siteOrigin: string;
  mediaOrigin: string;
  supabaseOrigin: string | null;
  supabasePublishableKey: string | null;
}
```

Implementation rules:

- Parse URL fields with `new URL`, require origin-only values, and strip no paths silently.
- For release mode require the two exact production origins.
- Require local Supabase fields only in `local-snapshot`; fixture mode returns them as `null`.
- Decode only the JWT payload segment with `Buffer.from(segment, "base64url")`; malformed JWT input returns `invalid_publishable_key` without throwing or echoing the key.
- Select `path.win32` when `repoRoot` begins with a drive prefix and `path.posix` for POSIX roots, normalize slash direction through that selected implementation, then resolve `repoRoot`, `repoRoot/dist`, and `outputRoot`. Use its `relative(distRoot, outputRoot)` and reject empty, `..`, absolute, sibling-prefix, and mixed-separator escapes. This keeps the Windows-path tests valid in Linux CI.
- Return only `{field, rule}` issues and never interpolate rejected values.
- Add `/dist/` under the production-output section of `.gitignore`.

- [ ] **Step 4: Run the focused test and typecheck**

Run: `npm.cmd test -- tests/cloudflare-static-build-preflight.test.ts`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- .gitignore src/cloudflare/static-build/validation.ts src/cloudflare/static-build/preflight.ts tests/cloudflare-static-build-preflight.test.ts
git commit -m "feat(cloudflare): validate static build preflight"
```

### Task 2: Frozen Catalog Snapshot Contract

**Files:**
- Create: `src/cloudflare/static-build/snapshot.ts`
- Create: `tests/cloudflare-static-build-snapshot.test.ts`

**Interfaces:**
- Consumes: unknown JSON-compatible snapshot data loaded by the snapshot adapter in slice 2.
- Produces: validated `CatalogSnapshot` with stable schema version `1`; route derivation in slice 2 may assume all references exist and all lists are duplicate-free.

- [ ] **Step 1: Write the failing snapshot tests**

Use a small valid fixture and mutate one relation at a time:

```ts
import { describe, expect, it } from "vitest";
import {
  validateCatalogSnapshot,
  type CatalogSnapshot,
} from "@/cloudflare/static-build/snapshot";

const validSnapshot = (): CatalogSnapshot => ({
  schemaVersion: 1,
  snapshotId: "fixture-2026-09-22",
  categories: [{ slug: "pumps", name: "Насосы", type: "subcategory" }],
  subcategories: [{ slug: "gear", name: "Шестерённые", categorySlug: "pumps" }],
  brands: [{ slug: "kamaz", name: "КАМАЗ" }],
  vehicleTypes: [{ slug: "truck", name: "Грузовик" }],
  categoryBrands: { pumps: ["kamaz"] },
  directProductCategorySlugs: ["pumps"],
  products: [{
    slug: "nsh-32",
    name: "НШ-32",
    category: "pumps",
    subcategory: "gear",
    compatibleBrands: ["kamaz"],
    vehicleTypes: ["truck"],
    images: [{ url: "https://media.ayprom-gidravlika.kg/nsh-32.webp" }],
    shortDescription: "Насос",
    updatedAt: "2026-09-22T00:00:00.000Z",
  }],
});

describe("catalog snapshot contract", () => {
  it("accepts a complete frozen snapshot", () => {
    expect(validateCatalogSnapshot(validSnapshot())).toEqual({
      ok: true,
      value: validSnapshot(),
    });
  });

  it.each([
    ["duplicate category", (s: CatalogSnapshot) => s.categories.push(s.categories[0]), "categories", "duplicate_slug"],
    ["missing product category", (s: CatalogSnapshot) => { s.products[0].category = "missing"; }, "products[0].category", "unknown_category"],
    ["wrong subcategory parent", (s: CatalogSnapshot) => { s.subcategories[0].categorySlug = "missing"; }, "subcategories[0].categorySlug", "unknown_category"],
    ["missing product subcategory", (s: CatalogSnapshot) => { s.products[0].subcategory = "missing"; }, "products[0].subcategory", "unknown_subcategory"],
    ["missing compatible brand", (s: CatalogSnapshot) => { s.products[0].compatibleBrands = ["missing"]; }, "products[0].compatibleBrands[0]", "unknown_brand"],
    ["missing vehicle type", (s: CatalogSnapshot) => { s.products[0].vehicleTypes = ["missing"]; }, "products[0].vehicleTypes[0]", "unknown_vehicle_type"],
    ["missing category-brand category", (s: CatalogSnapshot) => { s.categoryBrands = { missing: ["kamaz"] }; }, "categoryBrands.missing", "unknown_category"],
    ["missing category-brand brand", (s: CatalogSnapshot) => { s.categoryBrands = { pumps: ["missing"] }; }, "categoryBrands.pumps[0]", "unknown_brand"],
  ])("rejects %s", (_name, mutate, field, rule) => {
    const snapshot = validSnapshot();
    mutate(snapshot);
    expect(validateCatalogSnapshot(snapshot)).toMatchObject({
      ok: false,
      code: "snapshot_invalid",
      issues: expect.arrayContaining([{ field, rule }]),
    });
  });

  it("rejects malformed unknown input without throwing", () => {
    expect(validateCatalogSnapshot({ schemaVersion: 2, products: "secret-value" })).toMatchObject({
      ok: false,
      code: "snapshot_invalid",
      issues: expect.arrayContaining([
        { field: "schemaVersion", rule: "unsupported_schema" },
      ]),
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test -- tests/cloudflare-static-build-snapshot.test.ts`

Expected: FAIL because the snapshot module does not exist.

- [ ] **Step 3: Implement snapshot types and referential validation**

Define focused snapshot types rather than importing React-facing `Category` or `Product` types:

```ts
export interface SnapshotCategory {
  slug: string;
  name: string;
  type: "subcategory" | "brand" | null;
}

export interface SnapshotSubcategory {
  slug: string;
  name: string;
  categorySlug: string;
}

export interface SnapshotBrand { slug: string; name: string }
export interface SnapshotVehicleType { slug: string; name: string }

export interface SnapshotProduct {
  slug: string;
  name: string;
  category: string;
  subcategory?: string;
  compatibleBrands: string[];
  vehicleTypes: string[];
  images: { url: string; fallbackUrl?: string; scale?: number }[];
  shortDescription: string;
  article?: string;
  updatedAt: string;
}

export interface CatalogSnapshot {
  schemaVersion: 1;
  snapshotId: string;
  categories: SnapshotCategory[];
  subcategories: SnapshotSubcategory[];
  brands: SnapshotBrand[];
  vehicleTypes: SnapshotVehicleType[];
  categoryBrands: Record<string, string[]>;
  directProductCategorySlugs: string[];
  products: SnapshotProduct[];
}
```

Validation must accumulate stable `{field, rule}` issues, reject blank or slash-containing slugs, reject duplicate slugs within each entity collection, validate ISO timestamps, validate all relations listed in the test, and return the original typed snapshot only after every check passes. Do not normalize or silently delete invalid input.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm.cmd test -- tests/cloudflare-static-build-snapshot.test.ts`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add -- src/cloudflare/static-build/snapshot.ts tests/cloudflare-static-build-snapshot.test.ts
git commit -m "feat(cloudflare): define frozen catalog snapshot"
```

### Task 3: Deterministic Route Manifest Primitives

**Files:**
- Create: `src/cloudflare/static-build/route-manifest.ts`
- Create: `tests/cloudflare-static-build-route-manifest.test.ts`

**Interfaces:**
- Consumes: a validated `snapshotId` plus already-derived route entries; actual catalog-to-route derivation belongs to slice 2.
- Produces: discriminated `RouteManifestEntry`, `routePathToOutputFile(path)`, `createRouteManifest(snapshotId, entries)`, and `serializeRouteManifest(manifest)`.

- [ ] **Step 1: Write failing path, collision, and determinism tests**

```ts
import { describe, expect, it } from "vitest";
import {
  createRouteManifest,
  routePathToOutputFile,
  serializeRouteManifest,
  type RouteManifestEntry,
} from "@/cloudflare/static-build/route-manifest";

const page = (path: string): RouteManifestEntry => ({
  class: "static",
  family: "category",
  path,
  outputFile: routePathToOutputFile(path),
  expectedCanonical: `https://www.ayprom-gidravlika.kg${path}`,
  expectedJsonLdTypes: ["BreadcrumbList"],
  expectedIndexable: true,
  snapshotIds: ["fixture"],
});

describe("route manifest primitives", () => {
  it.each([
    ["/", "index.html"],
    ["/about", "about.html"],
    ["/catalog/category/pto", "catalog/category/pto.html"],
    ["/robots.txt", "robots.txt"],
    ["/sitemap.xml", "sitemap.xml"],
    ["/404", "404.html"],
  ])("maps %s to %s", (route, file) => {
    expect(routePathToOutputFile(route)).toBe(file);
  });

  it.each(["catalog", "/catalog/", "/catalog?q=x", "/catalog#x", "/../secret", "/a\\b", "//catalog"])(
    "rejects ambiguous route path %s",
    (route) => expect(() => routePathToOutputFile(route)).toThrow("invalid route path"),
  );

  it("sorts entries by code unit and serializes identical input byte-for-byte", () => {
    const first = createRouteManifest("fixture", [page("/catalog"), page("/about"), page("/")]);
    const second = createRouteManifest("fixture", [page("/"), page("/catalog"), page("/about")]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected valid manifests");
    expect(first.value.entries.map((entry) => entry.path)).toEqual(["/", "/about", "/catalog"]);
    expect(serializeRouteManifest(first.value)).toBe(serializeRouteManifest(second.value));
  });

  it.each([
    [[page("/catalog"), page("/catalog")], "duplicate_path"],
    [[page("/Brand"), page("/brand")], "case_insensitive_output_collision"],
  ])("rejects route ambiguity", (entries, rule) => {
    expect(createRouteManifest("fixture", entries)).toMatchObject({
      ok: false,
      code: "route_manifest_incomplete",
      issues: expect.arrayContaining([expect.objectContaining({ rule })]),
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test -- tests/cloudflare-static-build-route-manifest.test.ts`

Expected: FAIL because the route-manifest module does not exist.

- [ ] **Step 3: Implement the route union and deterministic helpers**

Use a discriminated union so impossible combinations cannot compile:

```ts
export type RouteFamily =
  | "home" | "about" | "contacts" | "catalog"
  | "category" | "subcategory" | "brand" | "vehicle-type"
  | "category-brand" | "brand-category" | "brand-category-subcategory"
  | "product" | "product-alias" | "robots" | "sitemap" | "not-found";

interface RouteEntryBase {
  family: RouteFamily;
  path: string;
  snapshotIds: string[];
}

export type RouteManifestEntry =
  | (RouteEntryBase & {
      class: "static" | "query";
      outputFile: string;
      expectedCanonical: string | null;
      expectedJsonLdTypes: string[];
      expectedIndexable: boolean;
    })
  | (RouteEntryBase & {
      class: "redirect";
      redirectTo: string;
      status: 308;
    })
  | (RouteEntryBase & {
      class: "invalid";
      reason: "canonical_unresolved" | "snapshot_reference_invalid";
    });

export interface RouteManifest {
  schemaVersion: 1;
  snapshotId: string;
  entries: RouteManifestEntry[];
}
```

Implementation rules:

- `routePathToOutputFile` accepts only canonical absolute paths without query, fragment, backslash, duplicate slash, dot segment, percent-encoded slash/backslash, or non-root trailing slash.
- `/`, `/404`, `/robots.txt`, and `/sitemap.xml` use the explicit mappings in the tests; all other routes become `<path-without-leading-slash>.html`.
- `createRouteManifest` returns `ValidationResult<RouteManifest>`, recalculates each page output from its path, rejects a mismatched declared output, validates redirect targets, detects exact path duplicates and case-insensitive output collisions, and sorts entries with direct code-unit comparison rather than locale-sensitive `localeCompare`.
- `serializeRouteManifest` accepts only a successful `RouteManifest` and returns `JSON.stringify(manifest, null, 2) + "\n"`; no timestamp enters the output.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm.cmd test -- tests/cloudflare-static-build-route-manifest.test.ts`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add -- src/cloudflare/static-build/route-manifest.ts tests/cloudflare-static-build-route-manifest.test.ts
git commit -m "feat(cloudflare): define deterministic route manifest"
```

### Task 4: Cloudflare Static Artifact Policy

**Files:**
- Create: `src/cloudflare/static-build/artifact-policy.ts`
- Create: `tests/cloudflare-static-build-artifact-policy.test.ts`

**Interfaces:**
- Consumes: the assembler slice's in-memory inventory of normalized relative paths, byte sizes, and optional decoded text.
- Produces: `validateArtifactPolicy(files)` returning a summary and warning codes or `artifact_policy_failed` issues; it performs no filesystem reads itself.

- [ ] **Step 1: Write failing artifact policy tests**

```ts
import { describe, expect, it } from "vitest";
import {
  validateArtifactPolicy,
  type ArtifactCandidate,
} from "@/cloudflare/static-build/artifact-policy";

const baseFiles = (): ArtifactCandidate[] => [
  { path: "index.html", size: 100, text: "<html>AYPROM</html>" },
  { path: "404.html", size: 80, text: "<meta name=robots content=noindex>" },
  { path: "_next/static/app.js", size: 40, text: "console.log('ok')" },
];

describe("static artifact policy", () => {
  it("summarizes a safe artifact", () => {
    expect(validateArtifactPolicy(baseFiles())).toEqual({
      ok: true,
      value: { fileCount: 3, totalBytes: 220, maxFileBytes: 100, warnings: [] },
    });
  });

  it.each([
    [".env", "forbidden_path"],
    ["assets/app.js.map", "forbidden_path"],
    ["_worker.js", "forbidden_path"],
    ["src/private.ts", "forbidden_path"],
    ["node_modules/pkg/index.js", "forbidden_path"],
    ["docs/readme.MD", "forbidden_path"],
    ["route.segment.RSC", "forbidden_path"],
    ["videos/hero.mp4", "forbidden_path"],
    ["..\\secret.txt", "invalid_path"],
    ["assets/%2e%2e/secret.txt", "invalid_path"],
    ["assets/%5csecret.txt", "invalid_path"],
  ])("rejects forbidden path %s", (path, rule) => {
    expect(validateArtifactPolicy([...baseFiles(), { path, size: 1 }])).toMatchObject({
      ok: false,
      code: "artifact_policy_failed",
      issues: expect.arrayContaining([expect.objectContaining({ field: path, rule })]),
    });
  });

  it.each([
    "service_role",
    "SeRvIcE_RoLe",
    "sb_secret_example",
    "SUPABASE_SECRET_KEY",
    "ADMIN_PASSWORD",
    "ADMIN_SESSION_SECRET",
    "R2_SECRET_ACCESS_KEY",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "/storage/v1/object/public/site-media/hero",
    "preview.vercel.app",
    "/_next/image",
  ])("rejects forbidden text marker without returning its value: %s", (marker) => {
    const result = validateArtifactPolicy([
      ...baseFiles(),
      { path: "catalog.html", size: marker.length, text: marker },
    ]);
    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([{ field: "catalog.html", rule: "forbidden_content" }]),
    });
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it("rejects a file above 25 MiB", () => {
    expect(validateArtifactPolicy([{ path: "large.webp", size: 25 * 1024 * 1024 + 1 }])).toMatchObject({
      ok: false,
      issues: [{ field: "large.webp", rule: "file_too_large" }],
    });
  });

  it("warns at 15,000 files and rejects 20,001 files", () => {
    const makeFiles = (count: number) => Array.from({ length: count }, (_, index) => ({
      path: `assets/${index}.txt`, size: 1,
    }));
    expect(validateArtifactPolicy(makeFiles(15_000))).toMatchObject({
      ok: true,
      value: { warnings: ["file_count_warning"] },
    });
    expect(validateArtifactPolicy(makeFiles(20_001))).toMatchObject({
      ok: false,
      issues: [{ field: "files", rule: "file_count_limit_exceeded" }],
    });
  });

  it("rejects exact and case-insensitive collisions", () => {
    expect(validateArtifactPolicy([
      { path: "Catalog.html", size: 1 },
      { path: "catalog.html", size: 1 },
    ])).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ rule: "case_insensitive_collision" })]),
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test -- tests/cloudflare-static-build-artifact-policy.test.ts`

Expected: FAIL because the artifact-policy module does not exist.

- [ ] **Step 3: Implement the pure artifact policy**

Use these public types and constants:

```ts
export const STATIC_ASSET_WARNING_COUNT = 15_000;
export const STATIC_ASSET_MAX_COUNT = 20_000;
export const STATIC_ASSET_MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface ArtifactCandidate {
  path: string;
  size: number;
  text?: string;
}

export interface ArtifactPolicySummary {
  fileCount: number;
  totalBytes: number;
  maxFileBytes: number;
  warnings: ("file_count_warning")[];
}
```

Implementation rules:

- Treat candidate paths as POSIX artifact paths; reject backslashes, absolute paths, empty/dot segments, traversal, duplicate slashes, drive prefixes, and percent-encoded slash, backslash, or dot-segment escapes before pattern matching.
- Match forbidden extensions and directory names case-insensitively.
- Forbid `.env` and `.env.*`, `*.map`, `_worker.js`, `src/**`, `node_modules/**`, `*.md`, `*.rsc`, `*.segment.rsc`, `.meta`, and local video formats `mp4`, `webm`, `mov`.
- Scan each supplied text independently with case-insensitive secret/config patterns, but return only the candidate path and `forbidden_content`; never include the matched text.
- Detect both exact normalized duplicates and lowercase collisions.
- Accumulate deterministic issues in input order, then path order for collision issues.
- Return no summary when any hard issue exists.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm.cmd test -- tests/cloudflare-static-build-artifact-policy.test.ts`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```powershell
git add -- src/cloudflare/static-build/artifact-policy.ts tests/cloudflare-static-build-artifact-policy.test.ts
git commit -m "feat(cloudflare): enforce static artifact policy"
```

### Task 5: Public Contract Surface and Slice Verification

**Files:**
- Create: `src/cloudflare/static-build/index.ts`
- Modify: `package.json`
- Test: all four `tests/cloudflare-static-build-*.test.ts` files

**Interfaces:**
- Consumes: the four completed pure modules.
- Produces: one stable import surface and one focused command for downstream slices and CI.

- [ ] **Step 1: Write a failing public-surface import test**

Add to `tests/cloudflare-static-build-preflight.test.ts`:

```ts
import * as staticBuild from "@/cloudflare/static-build";

it("exports the complete slice-one contract surface", () => {
  expect(Object.keys(staticBuild).sort()).toEqual([
    "STATIC_ASSET_MAX_COUNT",
    "STATIC_ASSET_MAX_FILE_BYTES",
    "STATIC_ASSET_WARNING_COUNT",
    "createRouteManifest",
    "routePathToOutputFile",
    "serializeRouteManifest",
    "validateArtifactPolicy",
    "validateCatalogSnapshot",
    "validateStaticBuildPreflight",
  ]);
});
```

- [ ] **Step 2: Run all contract suites and verify RED**

Run:

```powershell
npm.cmd test -- tests/cloudflare-static-build-preflight.test.ts tests/cloudflare-static-build-snapshot.test.ts tests/cloudflare-static-build-route-manifest.test.ts tests/cloudflare-static-build-artifact-policy.test.ts
```

Expected: FAIL because `@/cloudflare/static-build` has no index module.

- [ ] **Step 3: Add explicit exports and the focused npm command**

Create `index.ts` with named value exports only:

```ts
export { validateStaticBuildPreflight } from "./preflight";
export { validateCatalogSnapshot } from "./snapshot";
export {
  createRouteManifest,
  routePathToOutputFile,
  serializeRouteManifest,
} from "./route-manifest";
export {
  STATIC_ASSET_MAX_COUNT,
  STATIC_ASSET_MAX_FILE_BYTES,
  STATIC_ASSET_WARNING_COUNT,
  validateArtifactPolicy,
} from "./artifact-policy";
```

Add this package script without changing existing scripts:

```json
"test:cloudflare:static-contracts": "vitest run tests/cloudflare-static-build-preflight.test.ts tests/cloudflare-static-build-snapshot.test.ts tests/cloudflare-static-build-route-manifest.test.ts tests/cloudflare-static-build-artifact-policy.test.ts"
```

- [ ] **Step 4: Run focused and complete verification**

Run: `npm.cmd run test:cloudflare:static-contracts`

Expected: all four files PASS.

Run: `npm.cmd run check`

Expected: lint, typecheck, color checks, and the entire Vitest suite PASS.

Run: `npm.cmd run build`

Expected: Next production build PASS with the existing legacy adapter unchanged.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 5: Confirm boundaries before the slice checkpoint**

Run:

```powershell
git diff --name-only HEAD
git status --short --branch
```

Expected tracked paths are limited to `.gitignore`, `package.json`, the six `src/cloudflare/static-build/*.ts` files, and four contract test files. The protected untracked paths remain untouched. `wrangler.static-assets.jsonc`, `src/cloudflare/worker.ts`, Next pages, and production configuration are absent from the diff.

- [ ] **Step 6: Update Graphify and create the local slice checkpoint**

Run: `graphify update .`

Expected: graph update succeeds; a zero-node warning for non-code configuration files is non-blocking if the code graph completes.

```powershell
git add -- .gitignore package.json src/cloudflare/static-build tests/cloudflare-static-build-preflight.test.ts tests/cloudflare-static-build-snapshot.test.ts tests/cloudflare-static-build-route-manifest.test.ts tests/cloudflare-static-build-artifact-policy.test.ts
git commit -m "feat(cloudflare): establish static build contracts"
```

If Tasks 1-4 already produced individual commits, this final commit contains only `index.ts`, `package.json`, and any verification-only corrections. Do not squash, push, deploy, or change remote state.

- [ ] **Step 7: Record exact handoff evidence**

Run:

```powershell
git status --short --branch
git rev-parse --short HEAD
```

Report the focused test count, full `npm run check` count, build result, Graphify result, exact HEAD, exact Git status, and that no Worker bundle-size measurement changed because this slice does not alter the Worker bundle.
