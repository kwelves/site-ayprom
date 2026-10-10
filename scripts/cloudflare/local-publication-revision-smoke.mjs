// Prove the revision migration against an isolated local Supabase stack.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, lstatSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertPortsFree, command, createIsolatedProject } from "./local-admin-auth-smoke.mjs";
import { checkLocalPublicRelease } from "./local-public-release-check.mjs";
import { verifyPackagedWorker } from "./package-worker-assets-lib.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PREFIX = "ayprom-publication-revision-";
register("./static-producer-loader.mjs", { parentURL: import.meta.url, data: { srcRoot: path.join(ROOT, "src") } });
const { readPublicContentRevision, runRevisionFencedWork } = await import(pathToFileURL(
  path.join(ROOT, "src/cloudflare/static-build/producer/publication-revision.ts"),
).href);

function safeToRemove(directory) {
  const canonical = realpathSync(directory);
  return path.dirname(canonical) === realpathSync(os.tmpdir())
    && path.basename(canonical).startsWith(PREFIX)
    && canonical === path.resolve(directory)
    && lstatSync(directory).isDirectory()
    && !lstatSync(directory).isSymbolicLink();
}

async function main() {
  await assertPortsFree();
  const directory = mkdtempSync(path.join(os.tmpdir(), PREFIX));
  const projectId = `ayprom-revision-${randomBytes(5).toString("hex")}`;
  const checks = [];
  let started = false;
  let cleanup = false;
  let passed = false;
  try {
    createIsolatedProject(directory, projectId);
    started = true;
    command("supabase", ["start", "--workdir", directory,
      "--exclude", "studio,realtime,storage-api,imgproxy,postgres-meta,mailpit,edge-runtime,logflare,vector,supavisor",
      "--yes"], "isolated_stack_start_failed");
    checks.push("migrations_applied_in_isolated_stack");

    const tap = spawnSync("supabase", ["test", "db", "--local", "--workdir", directory,
      path.join(ROOT, "supabase/tests/database/publication_revision.test.sql")], {
      cwd: ROOT, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
    });
    if (tap.status !== 0 || tap.error) {
      // pgTAP stdout contains assertion results, never credentials or bindings.
      console.error(JSON.stringify({ stage: "revision_pgtap", output: tap.stdout?.slice(-6000) ?? "" }));
      throw new Error("revision_pgtap_failed");
    }
    checks.push("revision_pgtap_passed");

    const status = JSON.parse(command("supabase", ["status", "--workdir", directory, "--output", "json"], "isolated_status_failed"));
    assert.equal(status.API_URL, "http://127.0.0.1:56421");
    const publicKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
    const privateKey = status.SERVICE_ROLE_KEY;
    assert.ok(publicKey && privateKey);
    const read = () => readPublicContentRevision({ url: status.API_URL, key: publicKey });
    assert.equal(await read(), 0);
    await assert.rejects(runRevisionFencedWork(read, async () => {
      const inserted = await fetch(`${status.API_URL}/rest/v1/categories`, {
        method: "POST", headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
        body: JSON.stringify({ slug: "revision-smoke", name: "Revision smoke", description: "Test", icon: "gear", image: "" }),
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(inserted.status, 201);
      return "stale-staging";
    }), { message: "publication_revision_changed" });
    assert.equal(await read(), 1);
    const stable = await runRevisionFencedWork(read, async (revision) => {
      assert.equal(revision, 1);
      return "stable-staging";
    });
    assert.deepEqual(stable, { revision: 1, value: "stable-staging" });
    checks.push("public_revision_rpc_and_stale_work_rejection");
    // The global navigation links to the homepage showcase. An empty DB
    // suppresses that section, so seed its smallest valid local fixture.
    const vehicle = await fetch(`${status.API_URL}/rest/v1/vehicle_types`, {
      method: "POST",
      headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify({ slug: "kran-manipulyator", name: "Кран-Манипулятор", order: 0 }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(vehicle.status, 201);
    const hotspot = await fetch(`${status.API_URL}/rest/v1/vehicle_hotspots`, {
      method: "POST",
      headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify({ vehicle_type_slug: "kran-manipulyator", hotspot_number: 1, label: "Гидронасос", x_pct: 50, y_pct: 50 }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(hotspot.status, 201);
    const shaftId = randomUUID();
    const product = await fetch(`${status.API_URL}/rest/v1/products`, {
      method: "POST",
      headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        id: shaftId, slug: "shaft", name: "Shaft", category_slug: "revision-smoke",
        short_description: "Isolated test only", article: "REVISION-SHAFT", published: true, order: 0,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(product.status, 201);
    const image = await fetch(`${status.API_URL}/rest/v1/product_images`, {
      method: "POST",
      headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify({ product_id: shaftId, url: "/brand/ayprom-icon.svg", order: 0 }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(image.status, 201);
    const extraProductRows = Array.from({ length: 29 }, (_, index) => ({
      id: randomUUID(),
      slug: `local-part-${String(index + 1).padStart(2, "0")}`,
      name: `Local part ${String(index + 1).padStart(2, "0")}`,
      category_slug: "revision-smoke", short_description: "Isolated pagination test only",
      article: `LOCAL-PART-${index + 1}`, published: true, order: index + 1,
    }));
    const extraProducts = await fetch(`${status.API_URL}/rest/v1/products`, {
      method: "POST",
      headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify(extraProductRows),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(extraProducts.status, 201);
    const vehicleLinks = await fetch(`${status.API_URL}/rest/v1/product_vehicle_types`, {
      method: "POST",
      headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify([shaftId, ...extraProductRows.map((row) => row.id)]
        .map((productId) => ({ product_id: productId, vehicle_type_slug: "kran-manipulyator" }))),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(vehicleLinks.status, 201);
    const brandedCategory = await fetch(`${status.API_URL}/rest/v1/categories`, {
      method: "POST",
      headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify({ slug: "revision-branded", name: "Revision branded", description: "Isolated test only",
        icon: "gear", image: "/brand/ayprom-icon.svg", type: "brand" }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(brandedCategory.status, 201);
    const brand = await fetch(`${status.API_URL}/rest/v1/brands`, {
      method: "POST",
      headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify({ slug: "revision-brand", name: "Revision brand", country: "Local test",
        logo: "/brand/ayprom-icon.svg" }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(brand.status, 201);
    const categoryBrand = await fetch(`${status.API_URL}/rest/v1/category_brands`, {
      method: "POST",
      headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify({ category_slug: "revision-branded", brand_slug: "revision-brand" }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(categoryBrand.status, 201);
    const brandedProducts = Array.from({ length: 26 }, (_, index) => ({
      id: randomUUID(), slug: `revision-branded-${String(index + 1).padStart(2, "0")}`,
      name: `Revision branded ${String(index + 1).padStart(2, "0")}`,
      category_slug: "revision-branded", short_description: "Isolated brand pagination test only",
      article: `REVISION-BRANDED-${index + 1}`, published: true, order: index,
    }));
    const brandedInsert = await fetch(`${status.API_URL}/rest/v1/products`, {
      method: "POST",
      headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify(brandedProducts), signal: AbortSignal.timeout(10_000),
    });
    assert.equal(brandedInsert.status, 201);
    const brandedLinks = await fetch(`${status.API_URL}/rest/v1/product_brands`, {
      method: "POST",
      headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify(brandedProducts.map((row) => ({ product_id: row.id, brand_slug: "revision-brand" }))),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(brandedLinks.status, 201);
    const brandedCover = await fetch(`${status.API_URL}/rest/v1/product_images`, {
      method: "POST",
      headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify({ product_id: brandedProducts[0].id, url: "/brand/ayprom-icon.svg", order: 0 }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(brandedCover.status, 201);
    const brandedRpc = await fetch(`${status.API_URL}/rest/v1/rpc/search_catalog_products?offset=24&limit=24`, {
      method: "POST",
      headers: { apikey: publicKey, "content-type": "application/json", prefer: "count=exact" },
      body: JSON.stringify({ search_query: null, category_filter: "revision-branded", subcategory_filter: null,
        brand_filter: "revision-brand", vehicle_type_filter: null, require_no_subcategory: false }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(brandedRpc.ok, true);
    assert.equal(brandedRpc.headers.get("content-range"), "24-25/26");
    const brandedRpcRows = await brandedRpc.json();
    assert.deepEqual(brandedRpcRows.map((row) => row.slug), ["revision-branded-25", "revision-branded-26"]);
    checks.push("brand_category_public_rpc_second_page");
    const mixedCategory = await fetch(`${status.API_URL}/rest/v1/categories`, {
      method: "POST",
      headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify({ slug: "revision-mixed", name: "Revision mixed", description: "Isolated test only",
        icon: "gear", image: "/brand/ayprom-icon.svg", type: "subcategory" }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(mixedCategory.status, 201);
    const mixedSubcategoryId = randomUUID();
    const mixedSubcategory = await fetch(`${status.API_URL}/rest/v1/subcategories`, {
      method: "POST",
      headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify({ id: mixedSubcategoryId, category_slug: "revision-mixed", slug: "revision-parts",
        name: "Revision parts", image: "/brand/ayprom-icon.svg" }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(mixedSubcategory.status, 201);
    const mixedDirectProducts = Array.from({ length: 26 }, (_, index) => ({
      id: randomUUID(), slug: `revision-mixed-direct-${String(index + 1).padStart(2, "0")}`,
      name: `Revision mixed direct ${String(index + 1).padStart(2, "0")}`,
      category_slug: "revision-mixed", short_description: "Isolated mixed pagination test only",
      article: `REVISION-MIXED-${index + 1}`, published: true, order: index,
    }));
    const mixedDirectInsert = await fetch(`${status.API_URL}/rest/v1/products`, {
      method: "POST",
      headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify(mixedDirectProducts), signal: AbortSignal.timeout(10_000),
    });
    assert.equal(mixedDirectInsert.status, 201);
    const mixedCover = await fetch(`${status.API_URL}/rest/v1/product_images`, {
      method: "POST",
      headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify({ product_id: mixedDirectProducts[0].id, url: "/brand/ayprom-icon.svg", order: 0 }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(mixedCover.status, 201);
    const mixedNestedProducts = Array.from({ length: 26 }, (_, index) => ({
      id: randomUUID(),
      slug: index === 0 ? "revision-mixed-nested" : `revision-mixed-nested-${String(index + 1).padStart(2, "0")}`,
      name: index === 0 ? "Revision mixed nested" : `Revision mixed nested ${String(index + 1).padStart(2, "0")}`,
      category_slug: "revision-mixed", subcategory_id: mixedSubcategoryId,
      short_description: "Isolated mixed pagination test only", article: `REVISION-MIXED-NESTED-${index + 1}`,
      published: true, order: index + 27,
    }));
    const mixedNestedInsert = await fetch(`${status.API_URL}/rest/v1/products`, {
      method: "POST",
      headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify(mixedNestedProducts),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(mixedNestedInsert.status, 201);
    const mixedNestedBrandLinks = await fetch(`${status.API_URL}/rest/v1/product_brands`, {
      method: "POST",
      headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify(mixedNestedProducts.map((row) => ({ product_id: row.id, brand_slug: "revision-brand" }))),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(mixedNestedBrandLinks.status, 201);
    const mixedNestedCover = await fetch(`${status.API_URL}/rest/v1/product_images`, {
      method: "POST",
      headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify({ product_id: mixedNestedProducts[0].id, url: "/brand/ayprom-icon.svg", order: 0 }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(mixedNestedCover.status, 201);
    const mixedBrandRpc = await fetch(`${status.API_URL}/rest/v1/rpc/search_catalog_products?offset=24&limit=24`, {
      method: "POST",
      headers: { apikey: publicKey, "content-type": "application/json", prefer: "count=exact" },
      body: JSON.stringify({ search_query: null, category_filter: "revision-mixed", subcategory_filter: "revision-parts",
        brand_filter: "revision-brand", vehicle_type_filter: null, require_no_subcategory: false }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(mixedBrandRpc.ok, true);
    assert.equal(mixedBrandRpc.headers.get("content-range"), "24-25/26");
    const mixedBrandRpcRows = await mixedBrandRpc.json();
    assert.deepEqual(mixedBrandRpcRows.map((row) => row.slug), ["revision-mixed-nested-25", "revision-mixed-nested-26"]);
    checks.push("brand_subcategory_public_rpc_second_page");
    const mixedRpc = await fetch(`${status.API_URL}/rest/v1/rpc/search_catalog_products?offset=24&limit=24`, {
      method: "POST",
      headers: { apikey: publicKey, "content-type": "application/json", prefer: "count=exact" },
      body: JSON.stringify({ search_query: null, category_filter: "revision-mixed", subcategory_filter: null,
        brand_filter: null, vehicle_type_filter: null, require_no_subcategory: true }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(mixedRpc.ok, true);
    assert.equal(mixedRpc.headers.get("content-range"), "24-25/26");
    const mixedRpcRows = await mixedRpc.json();
    assert.deepEqual(mixedRpcRows.map((row) => row.slug), ["revision-mixed-direct-25", "revision-mixed-direct-26"]);
    checks.push("mixed_category_public_rpc_excludes_nested_product");
    const buildRevision = await read();
    const fullBuild = spawnSync(process.execPath, [
      path.join(ROOT, "scripts/cloudflare/local-revisioned-static-build.mjs"),
    ], {
      cwd: ROOT,
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
      },
      encoding: "utf8", windowsHide: true, timeout: 900_000, maxBuffer: 2 * 1024 * 1024,
    });
    let fullSummary;
    try { fullSummary = JSON.parse(fullBuild.stdout?.trim() ?? ""); }
    catch { fullSummary = null; }
    if (fullBuild.status !== 0 || fullSummary?.ok !== true || fullSummary.revision !== buildRevision) {
      const diagnostic = `${fullBuild.stdout ?? ""}\n${fullBuild.stderr ?? ""}`
        .replaceAll(publicKey, "[public-key]")
        .replaceAll(privateKey, "[private-key]")
        .slice(-4000);
      console.error(JSON.stringify({
        stage: "revisioned_full_build",
        code: fullSummary?.code ?? "build_process_failed",
        failedAt: fullSummary?.stage ?? null,
        diagnostic,
      }));
      throw new Error("revisioned_full_build_failed");
    }
    checks.push("revisioned_next_build_and_full_crawl_in_isolated_stack");
    const proof = JSON.parse(readFileSync(path.join(fullSummary.stagingDir, "meta/publication-revision-report.json"), "utf8"));
    assert.deepEqual(proof, { schemaVersion: 1, ok: true, revision: buildRevision });
    const packageEnv = {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
    };
    const packageRun = (name) => {
      const output = path.join(ROOT, "dist", "worker-packages", `${projectId}-${name}`);
      const processResult = spawnSync(process.execPath, [
        path.join(ROOT, "scripts/cloudflare/package-worker-assets.mjs"),
        "--staging", fullSummary.stagingDir,
        "--package", output,
      ], { cwd: ROOT, env: packageEnv, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
      let summary;
      try { summary = JSON.parse(processResult.stdout?.trim() ?? ""); }
      catch { summary = null; }
      return { output, processResult, summary };
    };
    const stablePackage = packageRun("stable");
    if (stablePackage.processResult.status !== 0 || stablePackage.summary?.ready !== true) {
      console.error(JSON.stringify({ stage: "revisioned_package", code: stablePackage.summary?.code ?? "package_process_failed" }));
      throw new Error("revisioned_package_failed");
    }
    const manifest = JSON.parse(readFileSync(path.join(stablePackage.output, "package-manifest.json"), "utf8"));
    assert.equal(manifest.sourceRevision, buildRevision);
    const packagedRevision = JSON.parse(readFileSync(path.join(stablePackage.output, "source-revision.json"), "utf8"));
    assert.deepEqual(packagedRevision, { schemaVersion: 1, revision: buildRevision });
    assert.equal(manifest.productionReady, false);
    checks.push("stable_public_package_with_revision_and_no_production_readiness");
    const resolvePackage = () => {
      const processResult = spawnSync(process.execPath, [
        path.join(ROOT, "scripts/cloudflare/resolve-public-package-cli.mjs"),
        "--package", path.basename(stablePackage.output),
      ], { cwd: ROOT, env: packageEnv, encoding: "utf8", windowsHide: true, timeout: 20_000, maxBuffer: 128 * 1024 });
      let summary;
      try { summary = JSON.parse(processResult.stdout?.trim() ?? ""); }
      catch { summary = null; }
      return { processResult, summary };
    };
    const selectedBefore = resolvePackage();
    assert.equal(selectedBefore.processResult.status, 0);
    assert.equal(selectedBefore.summary?.ok, true);
    assert.equal(selectedBefore.summary?.sourceRevision, buildRevision);
    checks.push("current_public_package_resolves_read_only");
    const localRuntime = await checkLocalPublicRelease({
      repoRoot: ROOT,
      packageName: path.basename(stablePackage.output),
      readCurrentRevision: read,
      supabaseUrl: status.API_URL,
      publishableKey: publicKey,
      searchQuery: "shaft",
      aliasPath: "/product/shaft",
      staticPath: "/catalog/category/revision-smoke/shaft",
      expectedSearchSlug: "shaft",
      expectedAliasPath: "/catalog/category/revision-smoke/shaft",
      probePackage: async (options) => {
        const probe = await verifyPackagedWorker(options);
        if (probe.health.status !== 200 || probe.search.status !== 200 || probe.search.slug !== "shaft"
          || probe.alias.status !== 308 || probe.alias.location !== "/catalog/category/revision-smoke/shaft"
          || probe.static.status !== 200) {
          console.error(JSON.stringify({ stage: "packaged_runtime_probe", probe }));
        }
        return probe;
      },
    });
    if (!localRuntime.ok) console.error(JSON.stringify({ stage: "local_public_release_check", result: localRuntime }));
    assert.deepEqual(localRuntime, { ok: true, sourceRevision: buildRevision, productionReady: false });
    checks.push("packaged_workerd_and_static_assets_pass_before_and_after_revision_checks");
    const browserRun = spawnSync(process.execPath, [
      path.join(ROOT, "scripts/cloudflare/local-browser-probe.mjs"),
      path.join(ROOT, ".wrangler/tools/wrangler-4.135.0/node_modules/wrangler/bin/wrangler.js"),
      "--existing-site", path.join(fullSummary.stagingDir, "site"),
    ], { cwd: ROOT, env: packageEnv, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
    let browserReport;
    try { browserReport = JSON.parse(browserRun.stdout?.trim() ?? ""); }
    catch { browserReport = null; }
    if (browserRun.status !== 0 || !browserReport || browserReport.pageErrors !== 0
      || browserReport.localHttpErrors?.length !== 0 || browserReport.uncapturedPrefetches !== 0) {
      console.error(JSON.stringify({ stage: "browser_probe", code: browserReport?.failure?.code ?? "browser_process_failed",
        failedAt: browserReport?.failure?.stage ?? null }));
      throw new Error("browser_probe_failed");
    }
    assert.ok(browserReport.checks.some((check) => check.name === "page_two_direct_url"
      && check.ok && check.itemCount > 0));
    assert.ok(browserReport.checks.some((check) => check.name === "page_two_click"
      && check.ok && check.itemCount > 0));
    for (const routePath of ["/catalog/category/revision-smoke", "/catalog/vehicle-type/kran-manipulyator", "/catalog/category/revision-mixed",
      "/catalog/category/revision-branded/brand/revision-brand",
      "/catalog/brand/revision-brand/category/revision-mixed/subcategory/revision-parts"]) {
      assert.ok(browserReport.checks.some((check) => check.name === "scoped_page_two_direct_url"
        && check.path === routePath && check.ok && check.itemCount > 0));
      assert.ok(browserReport.checks.some((check) => check.name === "scoped_page_two_click"
        && check.path === routePath && check.ok && check.itemCount > 0));
    }
    assert.ok(browserReport.checks.some((check) => check.name === "scoped_search"
      && check.path === "/catalog/category/revision-mixed/subcategory/revision-parts" && check.ok));
    assert.ok(browserReport.checks.some((check) => check.name === "scoped_search"
      && check.path === "/catalog/category/revision-branded/brand/revision-brand" && check.ok));
    assert.ok(browserReport.checks.some((check) => check.name === "scoped_search"
      && check.path === "/catalog/brand/revision-brand/category/revision-mixed/subcategory/revision-parts" && check.ok));
    assert.ok(browserReport.checks.some((check) => check.name === "brand_subcategory_page_two_product_link"
      && check.path === "/catalog/brand/revision-brand/category/revision-mixed/subcategory/revision-parts"
      && check.href === "/catalog/category/revision-mixed/subcategory/revision-parts/revision-mixed-nested-25"
      && check.navigatedPath === check.href && check.ok));
    assert.ok(browserReport.checks.some((check) => check.name === "brand_subcategory_search_product_link"
      && check.path === "/catalog/brand/revision-brand/category/revision-mixed/subcategory/revision-parts"
      && check.href === "/catalog/category/revision-mixed/subcategory/revision-parts/revision-mixed-nested"
      && check.ok));
    for (const name of ["mobile_menu_navigation", "mobile_keyboard_escape", "mobile_search", "mobile_page_two", "mobile_product_image_navigation", "mobile_no_horizontal_overflow"]) {
      assert.ok(browserReport.checks.some((check) => check.name === name && check.ok), `missing mobile browser check: ${name}`);
    }
    checks.push("chromium_nonempty_second_page_next_click_and_scoped_search");
    const changed = await fetch(`${status.API_URL}/rest/v1/categories?slug=eq.revision-smoke`, {
      method: "PATCH", headers: { apikey: privateKey, authorization: `Bearer ${privateKey}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Revision changed after staging" }), signal: AbortSignal.timeout(10_000),
    });
    assert.equal(changed.ok, true);
    assert.ok(await read() > buildRevision);
    const stalePackage = packageRun("stale");
    assert.equal(stalePackage.processResult.status, 1);
    assert.equal(stalePackage.summary?.code, "publication_revision_changed");
    assert.equal(existsSync(stalePackage.output), false);
    checks.push("stale_public_package_rejected_before_writing");
    const selectedAfter = resolvePackage();
    assert.equal(selectedAfter.processResult.status, 1);
    assert.equal(selectedAfter.summary?.code, "publication_revision_changed");
    checks.push("previously_selected_public_package_rejected_after_catalog_change");
    const staleRuntime = await checkLocalPublicRelease({
      repoRoot: ROOT,
      packageName: path.basename(stablePackage.output),
      readCurrentRevision: read,
      supabaseUrl: status.API_URL,
      publishableKey: publicKey,
      expectedSearchSlug: "shaft",
      expectedAliasPath: "/catalog/category/revision-smoke/shaft",
    });
    assert.deepEqual(staleRuntime, { ok: false, code: "publication_revision_changed" });
    checks.push("stale_package_refused_before_runtime_start");
    passed = true;
  } finally {
    if (started) {
      try { command("supabase", ["stop", "--project-id", projectId, "--no-backup", "--yes"], "isolated_stack_stop_failed"); }
      catch { process.exitCode = 1; }
    }
    if (safeToRemove(directory)) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      cleanup = true;
    } else process.exitCode = 1;
    console.log(JSON.stringify({ ok: passed && cleanup && process.exitCode !== 1, checks, cleanup }));
  }
}

main().catch(() => {
  console.error(JSON.stringify({ ok: false, failure: "publication_revision_smoke_failed" }));
  process.exitCode = 1;
});
