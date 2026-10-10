// Diagnostic only. Requires a prebuilt AYPROM_STATIC_BUILD=1 Next tree and the
// running shared LOCAL Supabase. Never builds, deploys, writes DB, or dist/site.
// node scripts/cloudflare/local-browser-probe.mjs <absolute wrangler.js>
// node scripts/cloudflare/local-browser-probe.mjs <absolute wrangler.js> --existing-site <absolute dist/staging/id/site>
// Optional with --existing-site: --scoped-paths <comma-separated manifest paths>
// for a representative local run. Without it, every query listing is checked.
// Supply NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in
// process memory. Output/report contain no key. Generated local config is outside
// site/, under ignored dist/staging; its public binding is erased in finally.
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { promises as fs } from "node:fs";
import net from "node:net";
import { spawnSync } from "node:child_process";
import { parse } from "parse5";
import { chromium } from "playwright";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
register("./static-producer-loader.mjs", { parentURL: import.meta.url, data: { srcRoot: path.join(repo, "src") } });
const load = (name) => import(pathToFileURL(path.join(repo, "src/cloudflare/static-build", name)).href);
const { isCatalogProductHref, localProbeBindings, probeDocumentFile, resolveExistingProbeSite, scopedPaginationProbeFilters, scopedPaginationProbePaths, selectScopedProbePaths, waitForLocalProbe } = await load("local-browser-probe.ts");
const { assertStagingRootAllowed, createStagingDirectory, writeStagingFile } = await load("producer/staging.ts");
const { readNextStaticAssets, writeNextStaticAssets } = await load("producer/static-assets.ts");
const { readReferencedPublicAssets } = await load("producer/public-assets.ts");
const { startChildServer } = await load("producer/child-server.ts");
const { routePathToOutputFile } = await load("route-manifest.ts");
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => controller.abort());
const report = { kind: "partial-local-browser-probe", release: false, checks: [], skipped: [], cleanup: [] };
let dirs, next, worker, browser, configPath, configOwned = false, existingSite = null, scopedPaths = [];
let stage = "preflight";

function anchors(html) {
  const result = [];
  function visit(node) {
    if (node.tagName === "a") {
      const attrs = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
      if (attrs.href) result.push(attrs);
    }
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(html));
  return result;
}
async function port() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value; // narrow port reservation race is diagnostic-only; failures stop.
}
async function stop(which) {
  if (!which) return;
  const result = await which.stop({ timeoutMs: 5000 });
  report.cleanup.push(result);
  if (!result.ok) process.exitCode = 1;
}
try {
  const bindings = localProbeBindings(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "");
  const wrangler = process.argv[2];
  if (!wrangler || !path.isAbsolute(wrangler)) throw new Error("absolute_wrangler_path_required");
  await fs.access(wrangler);
  existingSite = process.argv[3] === "--existing-site" ? process.argv[4] : null;
  const requestedScopedPaths = existingSite && process.argv[5] === "--scoped-paths" ? process.argv[6] : null;
  if ((!existingSite && process.argv.length !== 3)
    || (existingSite && process.argv.length !== (requestedScopedPaths === null ? 5 : 7))) throw new Error("invalid_probe_arguments");
  let catalog, product;
  if (existingSite) {
    report.kind = "full-local-browser-probe";
    dirs = resolveExistingProbeSite(repo, existingSite);
    await assertStagingRootAllowed(repo, dirs.siteDir);
    stage = "verify_existing_staging";
    const [crawl, html, sitemap, links] = await Promise.all([
      "crawl-report.json", "verification-report.json", "sitemap-verification.json", "link-verification.json",
    ].map(async (file) => JSON.parse(await fs.readFile(path.join(dirs.metaDir, file), "utf8"))));
    if (crawl.summary.failed !== 0 || crawl.summary.written !== crawl.summary.routes || !html.ok || !sitemap.ok || !links.ok) {
      throw new Error("existing_staging_not_verified");
    }
    catalog = await fs.readFile(path.join(dirs.siteDir, routePathToOutputFile("/catalog")), "utf8");
    const manifest = JSON.parse(await fs.readFile(path.join(dirs.metaDir, "route-manifest.json"), "utf8"));
    scopedPaths = selectScopedProbePaths(scopedPaginationProbePaths(manifest.entries), requestedScopedPaths);
    report.fullRouteCount = crawl.summary.routes;
    report.assetCount = (crawl.staticAssets?.fileCount ?? 0) + (crawl.publicAssets?.fileCount ?? 0);
  } else {
    await fs.access(path.join(repo, ".next/BUILD_ID"));
    const staticAssets = await readNextStaticAssets(path.join(repo, ".next/static"));
    const root = path.join(repo, "dist/staging");
    await assertStagingRootAllowed(repo, root);
    dirs = await createStagingDirectory(root);
    next = await startChildServer({
      command: process.execPath, args: [path.join(repo, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(await port())],
      cwd: repo, env: { NEXT_PUBLIC_SUPABASE_URL: bindings.SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: bindings.SUPABASE_PUBLISHABLE_KEY, AYPROM_STATIC_BUILD: "1", NEXT_PUBLIC_HERO_MEDIA_SOURCE: "r2", NEXT_PUBLIC_MEDIA_BASE_URL: "https://media.ayprom-gidravlika.kg", NEXT_TELEMETRY_DISABLED: "1" },
      readyPattern: /Local:\s+(http:\/\/127\.0\.0\.1:\d+)/, readyProbePath: "/catalog",
    }, { launchTimeoutMs: 30000, signal: controller.signal });
    async function capture(urlPath) {
      const response = await fetch(next.baseUrl + urlPath, { redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) throw new Error("capture_failed");
      const html = await response.text();
      if (Buffer.byteLength(html) > 5 * 1024 * 1024) throw new Error("capture_too_large");
      await writeStagingFile(dirs.siteDir, probeDocumentFile(urlPath), Buffer.from(html));
      return html;
    }
    catalog = await capture("/catalog");
    stage = "capture_product";
    product = anchors(catalog).find((a) => a["aria-label"] && isCatalogProductHref(a.href));
    if (!product) throw new Error("seed_product_missing");
    const productHtml = await capture(product.href);
    await stop(next); next = null; // Critical: no Next origin remains during browser checks.
    await writeNextStaticAssets(dirs.siteDir, staticAssets);
    stage = "collect_public_assets";
    const routePaths = [...new Set(["/", "/catalog", product.href, ...anchors(catalog + productHtml).map((a) => a.href.split(/[?#]/)[0])])];
    const publicAssets = await readReferencedPublicAssets({ siteDir: dirs.siteDir, publicDir: path.join(repo, "public"), repoRoot: repo, siteOrigin: "https://www.ayprom-gidravlika.kg", routePaths, reservedOutputFiles: staticAssets.map((a) => a.outputFile) });
    await writeNextStaticAssets(dirs.siteDir, publicAssets);
    report.assetCount = staticAssets.length + publicAssets.length;
  }
  product ??= anchors(catalog).find((a) => a["aria-label"] && isCatalogProductHref(a.href));
  if (!product) throw new Error("seed_product_missing");
  report.capturedPaths = ["/catalog", product.href];
  configPath = path.join(dirs.metaDir, "wrangler.local.json");
  const relativeToConfig = (target) => path.relative(dirs.metaDir, target).replaceAll("\\", "/");
  const workerEntry = existingSite ? path.join(dirs.metaDir, "alias-worker-entry.mjs") : path.join(repo, "src/cloudflare/worker.ts");
  await fs.access(workerEntry);
  await fs.writeFile(configPath, JSON.stringify({ name: "ayprom-local-browser-probe", main: relativeToConfig(workerEntry), compatibility_date: "2026-09-19", compatibility_flags: ["nodejs_compat"], workers_dev: false, assets: { directory: relativeToConfig(dirs.siteDir), html_handling: "drop-trailing-slash", not_found_handling: "404-page", run_worker_first: existingSite ? ["/api/*", "/product/*"] : ["/api/*"] }, vars: bindings }), { flag: "wx" });
  configOwned = true;
  if (existingSite) {
    stage = "worker_dry_run";
    const dryRun = spawnSync(process.execPath, [wrangler, "deploy", "--dry-run", "--config", configPath,
      "--outdir", path.join(dirs.metaDir, "worker-dry-run")], {
      cwd: repo, windowsHide: true, timeout: 30_000, encoding: "utf8", maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP,
        WRANGLER_SEND_METRICS: "false", WRANGLER_SEND_ERROR_REPORTING: "false", CI: "true" },
    });
    report.workerDryRun = { ok: dryRun.status === 0, exitCode: dryRun.status };
    if (dryRun.status !== 0) throw new Error("worker_dry_run_failed");
  }
  worker = await startChildServer({ command: process.execPath, args: [wrangler, "dev", "--local", "--config", configPath, "--ip", "127.0.0.1", "--port", String(await port()), "--inspector-port", "0", "--persist-to", path.join(dirs.metaDir, "state"), "--show-interactive-dev-session=false"], cwd: repo,
    env: { WRANGLER_SEND_METRICS: "false", WRANGLER_SEND_ERROR_REPORTING: "false", CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false", XDG_CONFIG_HOME: path.join(dirs.metaDir, "config"), CI: "true" },
    readyPattern: /Ready on (http:\/\/127\.0\.0\.1:\d+)/, readyProbePath: "/api/health",
  }, { launchTimeoutMs: 60000, signal: controller.signal });
  if (existingSite) {
    stage = "static_security_headers";
    const staticFiles = await fs.readdir(path.join(dirs.siteDir, "_next/static"), { recursive: true });
    const javascriptFile = staticFiles.find((file) => file.endsWith(".js"));
    const stylesheetFile = staticFiles.find((file) => file.endsWith(".css"));
    if (!javascriptFile || !stylesheetFile) throw new Error("static_stylesheet_or_javascript_missing");
    const paths = [
      ["catalog", "/catalog", 200], ["product", product.href, 200],
      ["robots", "/robots.txt", 200], ["sitemap", "/sitemap.xml", 200],
      ["not_found", "/ayprom-static-header-probe-missing", 404],
      ["stylesheet", "/_next/static/" + stylesheetFile.replaceAll("\\", "/"), 200],
      ["javascript", "/_next/static/" + javascriptFile.replaceAll("\\", "/"), 200],
    ];
    let passed = 0;
    const failed = [];
    for (const [kind, routePath, expectedStatus] of paths) {
      const response = await fetch(worker.baseUrl + routePath, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
      const csp = response.headers.get("content-security-policy") ?? "";
      const headers = response.headers;
      const mismatches = [];
      if (response.status !== expectedStatus) mismatches.push("status");
      if (!csp.includes("default-src 'self'") || !csp.includes("frame-ancestors 'none'")
        || !csp.includes("https://media.ayprom-gidravlika.kg") || csp.includes("'unsafe-eval'")) mismatches.push("csp");
      for (const [name, expected] of [
        ["referrer-policy", "strict-origin-when-cross-origin"],
        ["x-content-type-options", "nosniff"],
        ["x-frame-options", "DENY"],
        ["permissions-policy", "camera=(), microphone=(), geolocation=(), browsing-topics=()"],
        ["cross-origin-opener-policy", "same-origin"],
        ["strict-transport-security", "max-age=63072000; includeSubDomains; preload"],
      ]) {
        if (headers.get(name) !== expected) mismatches.push(name);
      }
      if (mismatches.length === 0) passed += 1;
      else failed.push({ kind, status: response.status, mismatches });
      await response.body?.cancel();
    }
    report.staticSecurityHeaders = { expected: paths.length, passed, ok: passed === paths.length, failed };
    report.checks.push({ name: "static_security_headers", ok: report.staticSecurityHeaders.ok });
  }
  stage = "browser_start";
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(15_000);
  // External media is out of scope. Never contact production services.
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return [new URL(worker.baseUrl).origin, bindings.SUPABASE_URL].includes(url.origin) ? route.continue() : route.abort();
  });
  const errors = [];
  const localHttpErrors = [];
  let uncapturedPrefetches = 0;
  page.on("pageerror", () => errors.push("page_error"));
  page.on("response", (response) => {
    if (response.status() >= 400 && new URL(response.url()).origin === new URL(worker.baseUrl).origin) {
      const headers = response.request().headers();
      if (headers["next-router-prefetch"] || headers.purpose === "prefetch" || headers["sec-purpose"]?.includes("prefetch")) {
        uncapturedPrefetches += 1;
      } else {
        localHttpErrors.push({ path: new URL(response.url()).pathname, status: response.status(), resourceType: response.request().resourceType() });
      }
    }
  });
  await page.goto(worker.baseUrl + "/catalog");
  stage = "search";
  const responsePromise = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/catalog/search", { timeout: 15000 });
  const input = page.getByRole("textbox", { name: "Поиск по каталогу", exact: true });
  await input.fill(product["aria-label"]);
  await input.press("Enter");
  const response = await responsePromise;
  const data = await response.json();
  report.checks.push({ name: "search", status: response.status(), count: data.items?.length ?? null, ok: response.ok() && data.items?.some((p) => product.href.endsWith("/" + p.slug)) === true });
  report.checks.push({ name: "search_url", ok: new URL(page.url()).searchParams.get("q") === product["aria-label"] });
  stage = "search_after_reload";
  const reloadedSearch = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/catalog/search", { timeout: 15000 });
  await page.goto(worker.baseUrl + `/catalog?q=${encodeURIComponent(product["aria-label"])}`);
  const reloaded = await reloadedSearch;
  const reloadedData = await reloaded.json();
  report.checks.push({ name: "search_after_reload", status: reloaded.status(), ok: reloaded.ok() && reloadedData.items?.some((p) => product.href.endsWith("/" + p.slug)) === true });
  stage = "empty_search";
  const emptySearch = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/catalog/search", { timeout: 15000 });
  await page.goto(worker.baseUrl + "/catalog?q=local-probe-no-match-7319");
  const emptyResponse = await emptySearch;
  const emptyData = await emptyResponse.json();
  report.checks.push({ name: "empty_search", status: emptyResponse.status(), ok: emptyResponse.ok() && emptyData.items?.length === 0 });
  stage = "page_two_direct_url";
  const secondPageRequest = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/catalog/search", { timeout: 15000 });
  await page.goto(worker.baseUrl + "/catalog?page=2");
  const secondPageResponse = await secondPageRequest;
  const secondPageData = await secondPageResponse.json();
  if (secondPageData.items?.length > 0) {
    await page.getByRole("link", { name: secondPageData.items[0].name, exact: true }).first().waitFor();
  } else {
    await page.getByText("Товаров пока нет", { exact: true }).waitFor();
  }
  report.checks.push({
    name: "page_two_direct_url",
    status: secondPageResponse.status(),
    itemCount: secondPageData.items?.length ?? null,
    ok: secondPageResponse.ok() && secondPageData.page === 2 && new URL(page.url()).searchParams.get("page") === "2",
  });
  if (secondPageData.items?.length > 0) {
    stage = "page_two_click";
    await page.goto(worker.baseUrl + "/catalog");
    const clickedPageRequest = page.waitForResponse((r) => {
      const url = new URL(r.url());
      return url.pathname === "/api/catalog/search" && url.searchParams.get("page") === "2";
    }, { timeout: 15000 });
    await page.getByRole("link", { name: "Вперёд", exact: true }).click();
    const clickedPageResponse = await clickedPageRequest;
    const clickedPageData = await clickedPageResponse.json();
    if (clickedPageData.items?.length > 0) {
      await page.getByRole("link", { name: clickedPageData.items[0].name, exact: true }).first().waitFor();
    }
    report.checks.push({
      name: "page_two_click",
      status: clickedPageResponse.status(),
      itemCount: clickedPageData.items?.length ?? null,
      ok: clickedPageResponse.ok() && clickedPageData.page === 2
        && clickedPageData.items?.length > 0 && new URL(page.url()).searchParams.get("page") === "2",
    });
  }
  for (const routePath of scopedPaths) {
    process.stderr.write(`[local-browser-probe] ${routePath}\n`);
    const expectedFilters = scopedPaginationProbeFilters(routePath);
    const brandSubcategory = /^\/catalog\/brand\/[a-z0-9-]+\/category\/([a-z0-9-]+)\/subcategory\/([a-z0-9-]+)$/.exec(routePath);
    const stagedHtml = await fs.readFile(path.join(dirs.siteDir, routePathToOutputFile(routePath)), "utf8");
    const mixedCategory = /^\/catalog\/category\/[a-z0-9-]+$/.test(routePath)
      && anchors(stagedHtml).some((anchor) => anchor.href.startsWith(routePath + "/subcategory/"));
    const apiUrl = new URL("/api/catalog/search", worker.baseUrl);
    apiUrl.searchParams.set("page", "2");
    for (const [name, value] of Object.entries(expectedFilters)) apiUrl.searchParams.set(name, value);
    if (mixedCategory) apiUrl.searchParams.set("noSubcategory", "1");
    stage = "scoped_node_api";
    const nodeApiResponse = await fetch(apiUrl, { signal: AbortSignal.timeout(15_000) });
    const nodeApiData = await waitForLocalProbe(nodeApiResponse.json(), 15_000);
    const nodeApiOk = nodeApiResponse.ok && nodeApiData.page === 2 && Array.isArray(nodeApiData.items);
    report.checks.push({ name: "scoped_node_api", path: routePath, status: nodeApiResponse.status,
      ok: nodeApiOk });
    if (!nodeApiOk) throw new Error("scoped_node_api_failed");
    process.stderr.write(`[local-browser-probe] Node API complete ${routePath}\n`);
    const pageTwoResponse = (r) => {
      const url = new URL(r.url());
      return url.pathname === "/api/catalog/search"
        && url.searchParams.get("page") === "2"
        && Object.entries(expectedFilters).every(([name, value]) => url.searchParams.get(name) === value);
    };
    stage = "scoped_page_two_direct_url";
    process.stderr.write(`[local-browser-probe] opening ${routePath}?page=2\n`);
    const directRequest = page.waitForResponse(pageTwoResponse, { timeout: 15000 });
    await page.goto(worker.baseUrl + routePath + "?page=2", { waitUntil: "domcontentloaded", timeout: 15_000 });
    process.stderr.write(`[local-browser-probe] document loaded ${routePath}\n`);
    const directResponse = await directRequest;
    process.stderr.write(`[local-browser-probe] API response ${routePath}\n`);
    const directData = await waitForLocalProbe(directResponse.json(), 15_000);
    process.stderr.write(`[local-browser-probe] API body ${routePath}\n`);
    const directUrl = new URL(directResponse.url());
    const mixedCategoryFiltersOk = directUrl.searchParams.get("noSubcategory") === (mixedCategory ? "1" : null);
    if (directData.items?.length > 0) {
      await page.getByRole("link", { name: directData.items[0].name, exact: true }).first().waitFor();
    }
    report.checks.push({
      name: "scoped_page_two_direct_url", path: routePath,
      status: directResponse.status(), itemCount: directData.items?.length ?? null,
      ok: directResponse.ok() && directData.page === 2 && mixedCategoryFiltersOk
        && new URL(page.url()).searchParams.get("page") === "2",
    });
    if (brandSubcategory && directData.items?.length > 0) {
      stage = "brand_subcategory_page_two_product_link";
      const item = directData.items[0];
      const expectedHref = `/catalog/category/${brandSubcategory[1]}/subcategory/${brandSubcategory[2]}/${item.slug}`;
      const productLink = page.getByRole("link", { name: item.name, exact: true }).first();
      const href = await productLink.getAttribute("href");
      await productLink.locator("..").getByRole("img").first().click();
      await page.waitForURL((url) => url.pathname !== routePath, { timeout: 15_000 });
      const navigatedPath = new URL(page.url()).pathname;
      const productHeading = await page.getByRole("heading", { level: 1, name: item.name, exact: true }).count();
      report.checks.push({ name: "brand_subcategory_page_two_product_link", path: routePath, href, navigatedPath,
        ok: href === expectedHref && navigatedPath === expectedHref && productHeading === 1 });
    }
    const searchProduct = anchors(stagedHtml).find((anchor) => anchor["aria-label"] && isCatalogProductHref(anchor.href));
    if (searchProduct && !mixedCategory) {
      stage = "scoped_search";
      await page.goto(worker.baseUrl + routePath, { waitUntil: "domcontentloaded", timeout: 15_000 });
      // The static HTML can be interactive-looking before Next has hydrated
      // its search form. Wait for local scripts to settle before submitting.
      await page.waitForLoadState("networkidle", { timeout: 15_000 });
      const scopedSearchResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/catalog/search"
          && url.searchParams.get("q") === searchProduct["aria-label"]
          && Object.entries(expectedFilters).every(([name, value]) => url.searchParams.get(name) === value);
      }, { timeout: 15_000 });
      const scopedInput = page.getByRole("textbox", { name: "Поиск по каталогу", exact: true });
      await scopedInput.fill(searchProduct["aria-label"]);
      await scopedInput.press("Enter");
      const searchResponse = await scopedSearchResponse;
      const searchData = await waitForLocalProbe(searchResponse.json(), 15_000);
      const productSlug = searchProduct.href.split("/").at(-1);
      const found = searchData.items?.some((item) => item.slug === productSlug) === true;
      if (found) await page.getByRole("link", { name: searchProduct["aria-label"], exact: true }).first().waitFor();
      report.checks.push({ name: "scoped_search", path: routePath, status: searchResponse.status(),
        ok: searchResponse.ok() && found && new URL(page.url()).searchParams.get("q") === searchProduct["aria-label"] });
      if (brandSubcategory && found) {
        const expectedHref = `/catalog/category/${brandSubcategory[1]}/subcategory/${brandSubcategory[2]}/${productSlug}`;
        const href = await page.getByRole("link", { name: searchProduct["aria-label"], exact: true }).first().getAttribute("href");
        report.checks.push({ name: "brand_subcategory_search_product_link", path: routePath, href,
          ok: href === expectedHref && searchProduct.href === expectedHref });
      }
    } else if (!mixedCategory) {
      report.skipped.push({ name: "scoped_search", path: routePath, reason: "no_static_product" });
    }
    if (directData.items?.length === 0) continue;
    stage = "scoped_page_two_click";
    await page.goto(worker.baseUrl + routePath);
    const clickedRequest = page.waitForResponse(pageTwoResponse, { timeout: 15000 });
    await page.getByRole("link", { name: "Вперёд", exact: true }).click();
    const clickedResponse = await clickedRequest;
    const clickedData = await clickedResponse.json();
    if (clickedData.items?.length > 0) {
      await page.getByRole("link", { name: clickedData.items[0].name, exact: true }).first().waitFor();
    }
    report.checks.push({
      name: "scoped_page_two_click", path: routePath,
      status: clickedResponse.status(), itemCount: clickedData.items?.length ?? null,
      ok: clickedResponse.ok() && clickedData.page === 2 && clickedData.items?.length > 0
        && new URL(page.url()).searchParams.get("page") === "2",
    });
  }
  stage = "product_keyboard";
  await page.goto(worker.baseUrl + "/catalog");
  await page.getByRole("link", { name: product["aria-label"], exact: true }).press("Enter");
  await page.waitForURL("**" + product.href, { timeout: 15000 });
  await page.waitForFunction((name) => {
    const headings = document.querySelectorAll("h1");
    return headings.length === 1 && headings[0].textContent?.trim() === name;
  }, product["aria-label"], { timeout: 15000 });
  report.checks.push({ name: "product_keyboard", ok: true });
  stage = "product_image_click";
  await page.goto(worker.baseUrl + "/catalog");
  await page.getByRole("img", { name: product["aria-label"], exact: true }).first().click();
  await page.waitForURL("**" + product.href, { timeout: 15000 });
  await page.waitForFunction((name) => {
    const headings = document.querySelectorAll("h1");
    return headings.length === 1 && headings[0].textContent?.trim() === name;
  }, product["aria-label"], { timeout: 15000 });
  report.checks.push({ name: "product_image_click", ok: true });
  if (existingSite) {
    stage = "mobile_browser_start";
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    });
    const mobile = await mobileContext.newPage();
    mobile.setDefaultTimeout(15_000);
    mobile.setDefaultNavigationTimeout(15_000);
    await mobile.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return [new URL(worker.baseUrl).origin, bindings.SUPABASE_URL].includes(url.origin) ? route.continue() : route.abort();
    });
    mobile.on("pageerror", () => errors.push("mobile_page_error"));
    mobile.on("response", (response) => {
      if (response.status() < 400 || new URL(response.url()).origin !== new URL(worker.baseUrl).origin) return;
      const headers = response.request().headers();
      if (headers["next-router-prefetch"] || headers.purpose === "prefetch" || headers["sec-purpose"]?.includes("prefetch")) {
        uncapturedPrefetches += 1;
      } else {
        localHttpErrors.push({ path: new URL(response.url()).pathname, status: response.status(), resourceType: response.request().resourceType() });
      }
    });
    await mobile.goto(worker.baseUrl + "/catalog", { waitUntil: "networkidle" });
    const mobileWidth = await mobile.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    report.checks.push({ name: "mobile_no_horizontal_overflow", ...mobileWidth,
      ok: mobileWidth.viewport === 390 && mobileWidth.document <= mobileWidth.viewport + 1 });

    stage = "mobile_menu_navigation";
    const menuToggle = mobile.getByRole("button", { name: "Открыть меню" });
    await menuToggle.click();
    const menuOpen = await mobile.getByRole("button", { name: "Закрыть меню" }).getAttribute("aria-expanded");
    await mobile.getByRole("button", { name: "Показать подраздел «Каталог»" }).click();
    const mobileCategoryLink = mobile.locator('header a[href="/catalog/category/revision-smoke"]');
    await mobileCategoryLink.click();
    await mobile.waitForURL((url) => url.pathname === "/catalog/category/revision-smoke");
    report.checks.push({ name: "mobile_menu_navigation", ok: menuOpen === "true"
      && new URL(mobile.url()).pathname === "/catalog/category/revision-smoke" });

    stage = "mobile_keyboard_escape";
    await mobile.goto(worker.baseUrl + "/catalog", { waitUntil: "networkidle" });
    await mobile.getByRole("button", { name: "Открыть меню" }).press("Enter");
    const keyboardMenuOpen = await mobile.getByRole("button", { name: "Закрыть меню" }).getAttribute("aria-expanded");
    await mobile.getByRole("button", { name: "Показать подраздел «Каталог»" }).press("Enter");
    const keyboardCategoryOpen = await mobile.getByRole("button", { name: "Скрыть подраздел «Каталог»" }).getAttribute("aria-expanded");
    await mobile.keyboard.press("Escape");
    const categoryAfterEscape = mobile.getByRole("button", { name: "Показать подраздел «Каталог»" });
    const categoryClosed = await categoryAfterEscape.getAttribute("aria-expanded");
    const categoryFocusReturned = await categoryAfterEscape.evaluate((element) =>
      element === document.activeElement && element.matches(":focus-visible"));
    const menuStillOpen = await mobile.getByRole("button", { name: "Закрыть меню" }).getAttribute("aria-expanded");
    await mobile.keyboard.press("Escape");
    const menuAfterEscape = mobile.getByRole("button", { name: "Открыть меню" });
    const menuClosed = await menuAfterEscape.getAttribute("aria-expanded");
    const menuFocusReturned = await menuAfterEscape.evaluate((element) =>
      element === document.activeElement && element.matches(":focus-visible"));
    report.checks.push({ name: "mobile_keyboard_escape", ok: keyboardMenuOpen === "true" && keyboardCategoryOpen === "true"
      && categoryClosed === "false" && categoryFocusReturned && menuStillOpen === "true"
      && menuClosed === "false" && menuFocusReturned });

    stage = "mobile_search";
    await mobile.goto(worker.baseUrl + "/catalog", { waitUntil: "networkidle" });
    const mobileSearchResponse = mobile.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/catalog/search" && url.searchParams.get("q") === product["aria-label"];
    });
    const mobileInput = mobile.getByRole("textbox", { name: "Поиск по каталогу", exact: true });
    await mobileInput.fill(product["aria-label"]);
    await mobileInput.press("Enter");
    const mobileSearch = await mobileSearchResponse;
    const mobileSearchData = await mobileSearch.json();
    if (mobileSearchData.items?.length > 0) {
      await mobile.getByRole("link", { name: product["aria-label"], exact: true }).first().waitFor();
    }
    report.checks.push({ name: "mobile_search", status: mobileSearch.status(),
      ok: mobileSearch.ok() && mobileSearchData.items?.some((item) => product.href.endsWith("/" + item.slug)) === true
        && new URL(mobile.url()).searchParams.get("q") === product["aria-label"] });

    stage = "mobile_page_two";
    await mobile.goto(worker.baseUrl + "/catalog", { waitUntil: "networkidle" });
    const mobilePageTwoResponse = mobile.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/catalog/search" && url.searchParams.get("page") === "2";
    });
    await mobile.getByRole("link", { name: "Вперёд", exact: true }).click();
    const mobilePageTwo = await mobilePageTwoResponse;
    const mobilePageTwoData = await mobilePageTwo.json();
    if (mobilePageTwoData.items?.length > 0) {
      await mobile.getByRole("link", { name: mobilePageTwoData.items[0].name, exact: true }).first().waitFor();
    }
    report.checks.push({ name: "mobile_page_two", status: mobilePageTwo.status(), itemCount: mobilePageTwoData.items?.length ?? null,
      ok: mobilePageTwo.ok() && mobilePageTwoData.page === 2 && mobilePageTwoData.items?.length > 0
        && new URL(mobile.url()).searchParams.get("page") === "2" });

    stage = "mobile_product_image_navigation";
    await mobile.goto(worker.baseUrl + "/catalog", { waitUntil: "networkidle" });
    await mobile.getByRole("img", { name: product["aria-label"], exact: true }).first().click();
    await mobile.waitForURL((url) => url.pathname === product.href);
    const mobileProductHeading = mobile.getByRole("heading", { level: 1, name: product["aria-label"], exact: true });
    const headingAtUrlChange = await mobileProductHeading.count();
    await mobileProductHeading.waitFor();
    report.checks.push({ name: "mobile_product_image_navigation", headingAtUrlChange,
      ok: await mobileProductHeading.count() === 1 });
    await mobileContext.close();
  }
  if (existingSite) {
    stage = "alias_redirects";
    const manifest = JSON.parse(await fs.readFile(path.join(dirs.metaDir, "route-manifest.json"), "utf8"));
    const aliases = manifest.entries.filter((entry) => entry.class === "redirect" && entry.family === "product-alias");
    let passed = 0;
    for (const alias of aliases) {
      const redirected = await fetch(worker.baseUrl + alias.path, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
      const location = redirected.headers.get("location");
      const target = location ? new URL(location, worker.baseUrl) : null;
      if (redirected.status !== 308 || !target || target.origin !== worker.baseUrl || target.pathname !== alias.redirectTo) continue;
      const destination = await fetch(worker.baseUrl + alias.redirectTo, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
      if (destination.status === 200) passed += 1;
      await destination.body?.cancel();
    }
    report.aliasRedirects = { expected: aliases.length, passed, ok: passed === aliases.length };
    report.checks.push({ name: "alias_redirects", ok: report.aliasRedirects.ok });
    const unknownAlias = await fetch(worker.baseUrl + "/product/ayprom-alias-probe-missing", {
      redirect: "manual", signal: AbortSignal.timeout(10_000),
    });
    report.checks.push({ name: "unknown_alias", status: unknownAlias.status, ok: unknownAlias.status === 404 });
    await unknownAlias.body?.cancel();
  }
  report.pageErrors = errors.length;
  report.uncapturedPrefetches = uncapturedPrefetches;
  report.localHttpErrors = localHttpErrors;
  if (errors.length || localHttpErrors.length || (existingSite && uncapturedPrefetches > 0) || report.checks.some((c) => !c.ok)) process.exitCode = 1;
} catch (error) {
  report.failure = { code: typeof error?.code === "string" ? error.code : "probe_failed", reason: typeof error?.reason === "string" ? error.reason : error?.name ?? "Error", stage };
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const summary = String(error?.message ?? "").split("\n")[0];
  report.failureSummary = (publicKey ? summary.replaceAll(publicKey, "[public-key]") : summary)
    .replace(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[jwt]").slice(0, 180);
  report.failureRules = [...new Set((error?.issues ?? []).map((issue) => issue.rule))];
  if (configOwned && !worker) {
    const diagnostic = spawnSync(process.execPath, [process.argv[2], "deploy", "--dry-run", "--config", configPath], {
      cwd: repo, windowsHide: true, timeout: 20000, encoding: "utf8", maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, WRANGLER_SEND_METRICS: "false", CI: "true" },
    });
    const scrub = (value) => (publicKey ? value.replaceAll(publicKey, "[public-key]") : value)
      .replace(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[jwt]");
    report.workerDiagnostic = { exitCode: diagnostic.status, lines: scrub(`${diagnostic.stderr ?? ""}\n${diagnostic.stdout ?? ""}`)
      .split(/\r?\n/).filter((line) => /error|fail|invalid|cannot|not found|No such/i.test(line)).slice(0, 5).map((line) => line.slice(0, 220)) };
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop(worker); await stop(next);
  if (configOwned) {
    try { await fs.unlink(configPath); }
    catch (error) {
      if (error?.code !== "ENOENT") {
        report.cleanup.push({ ok: false, reason: "config_remove_failed" });
        process.exitCode = 1;
      }
    }
  }
  if (dirs) await fs.writeFile(path.join(dirs.metaDir, existingSite ? "browser-probe-full.json" : "browser-probe.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, stagingDir: dirs?.stagingDir ?? null }));
}
