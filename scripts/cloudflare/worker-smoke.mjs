import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  buildIsolatedWranglerEnv,
  parseExplorerApiUrl,
  parseReadyUrl,
  validateStaticAssetManifest,
  validateBundlePolicy,
} from "./worker-smoke-lib.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const DEFAULT_WRANGLER_CONFIG = path.join(PROJECT_ROOT, "wrangler.jsonc");
const STATIC_ASSET_FIXTURE = path.join(
  PROJECT_ROOT,
  "fixtures",
  "cloudflare-static-assets",
);
const EXPECTED_WRANGLER_VERSION = "4.135.0";
const FAKE_PUBLISHABLE_KEY = "sb_publishable_local_worker_smoke_test";
const READY_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const PROCESS_STOP_TIMEOUT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 180_000;
const MAX_BUNDLE_BYTES = 16 * 1024;
// Независимая копия контракта (не импорт из src): smoke сверяет то, что
// реально отдаёт workerd, а не то, что думает о себе TypeScript-константа.
const EXPECTED_API_SECURITY_HEADERS = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  "cross-origin-opener-policy": "same-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
};

const SEARCH_ROW = {
  slug: "nsh-32",
  name: "Насос НШ-32",
  category_slug: "hydraulic-pumps",
  subcategory_slug: "gear-pumps",
  short_description: "Шестерённый насос",
  article: null,
  cover_url: "https://media.example/thumbnail.webp",
  cover_fallback_url: "https://media.example/master.png",
  cover_scale: null,
  compatible_brands: ["kamaz", "maz"],
};

const EXPECTED_PRODUCT = {
  slug: "nsh-32",
  name: "Насос НШ-32",
  category: "hydraulic-pumps",
  subcategory: "gear-pumps",
  compatibleBrands: ["kamaz", "maz"],
  images: [
    {
      url: "https://media.example/thumbnail.webp",
      fallbackUrl: "https://media.example/master.png",
    },
  ],
  shortDescription: "Шестерённый насос",
};

const SANITIZED_ERROR = {
  error: {
    code: "catalog_search_failed",
    message: "Catalog search is temporarily unavailable",
  },
};

let activeChild = null;
let activeMock = null;
let activeTempDirectory = null;

const totalTimeout = setTimeout(() => {
  void emergencyExit(124, "Worker smoke gate exceeded its total timeout");
}, TOTAL_TIMEOUT_MS);
totalTimeout.unref();

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    void emergencyExit(130, `Worker smoke gate interrupted by ${signal}`);
  });
}

process.once("uncaughtException", (error) => {
  console.error(error);
  void emergencyExit(1, "Worker smoke gate hit an uncaught exception");
});

try {
  await main();
} finally {
  clearTimeout(totalTimeout);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const wranglerPath = resolveWranglerPath(options.wranglerPath);
  const wranglerConfig = resolveWranglerConfig(options.configPath);
  const wranglerWorkingDirectory = path.join(PROJECT_ROOT, ".wrangler");
  mkdirSync(wranglerWorkingDirectory, { recursive: true });
  const runDirectory = mkdtempSync(
    path.join(wranglerWorkingDirectory, "smoke-"),
  );
  activeTempDirectory = runDirectory;

  try {
    const emptyEnvPath = path.join(runDirectory, "empty.env");
    writeFileSync(emptyEnvPath, "", "utf8");
    const childEnvironment = buildIsolatedWranglerEnv(
      process.env,
      path.join(runDirectory, "wrangler.log"),
      path.join(runDirectory, "xdg-config"),
    );

    verifyWranglerVersion(wranglerPath, childEnvironment);
    if (options.expectStaticAssets) {
      const assets = validateStaticAssetManifest(
        createStaticAssetManifest(STATIC_ASSET_FIXTURE),
      );
      console.log(
        `PASS static asset manifest: ${assets.fileCount} files, ${assets.totalBytes} bytes total, ${assets.maxFileBytes} bytes max`,
      );
    }
    const bundle = runBundleGate({
      wranglerPath,
      wranglerConfig,
      childEnvironment,
      emptyEnvPath,
      runDirectory,
    });

    console.log(
      `PASS bundle gate: ${bundle.rawBytes} bytes raw, ${bundle.gzipBytes} bytes gzip, ${bundle.inputCount} inputs`,
    );

    for (let run = 1; run <= options.repeat; run += 1) {
      const result = await runWorkerdSmoke({
        wranglerPath,
        wranglerConfig,
        childEnvironment,
        emptyEnvPath,
        runDirectory,
        run,
        expectStaticAssets: options.expectStaticAssets,
      });
      console.log(
        `PASS workerd run ${run}/${options.repeat}: ${result.passed}/${result.total} checks`,
      );
    }
  } finally {
    await stopActiveRuntime();
    removeVerifiedTempDirectory(runDirectory);
    activeTempDirectory = null;
  }
}

function parseArguments(args) {
  let wranglerPath;
  let configPath;
  let repeat = 1;
  let expectStaticAssets = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--wrangler") {
      wranglerPath = args[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--repeat") {
      repeat = Number(args[index + 1]);
      index += 1;
      continue;
    }
    if (argument === "--config") {
      configPath = args[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--expect-static-assets") {
      expectStaticAssets = true;
      continue;
    }
    throw new Error(`Unknown Worker smoke argument: ${argument}`);
  }

  if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 10) {
    throw new Error("--repeat must be an integer between 1 and 10");
  }

  return { wranglerPath, configPath, repeat, expectStaticAssets };
}

function resolveWranglerPath(requestedPath) {
  const localWrangler = path.join(
    PROJECT_ROOT,
    "node_modules",
    "wrangler",
    "bin",
    "wrangler.js",
  );
  const resolved = path.resolve(requestedPath ?? localWrangler);

  if (!existsSync(resolved)) {
    throw new Error(
      "Wrangler 4.135.0 not found. Pass its wrangler.js path with --wrangler.",
    );
  }

  return resolved;
}

function resolveWranglerConfig(requestedPath) {
  const resolved = path.resolve(requestedPath ?? DEFAULT_WRANGLER_CONFIG);
  if (!existsSync(resolved)) {
    throw new Error(`Wrangler config not found: ${resolved}`);
  }
  return resolved;
}

function verifyWranglerVersion(wranglerPath, childEnvironment) {
  const result = spawnSync(process.execPath, [wranglerPath, "--version"], {
    cwd: PROJECT_ROOT,
    env: childEnvironment,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Wrangler version check failed: ${firstLine(result.stderr)}`);
  }

  const version = `${result.stdout}\n${result.stderr}`.match(/\b\d+\.\d+\.\d+\b/)?.[0];
  if (version !== EXPECTED_WRANGLER_VERSION) {
    throw new Error(
      `Expected Wrangler ${EXPECTED_WRANGLER_VERSION}, received ${version ?? "unknown"}`,
    );
  }
}

function runBundleGate({
  wranglerPath,
  wranglerConfig,
  childEnvironment,
  emptyEnvPath,
  runDirectory,
}) {
  const outputDirectory = path.join(runDirectory, "bundle");
  const metafilePath = path.join(runDirectory, "bundle-meta.json");
  mkdirSync(outputDirectory, { recursive: true });

  const result = spawnSync(
    process.execPath,
    [
      wranglerPath,
      "deploy",
      "--dry-run",
      "--config",
      wranglerConfig,
      "--env-file",
      emptyEnvPath,
      "--outdir",
      outputDirectory,
      "--metafile",
      metafilePath,
    ],
    {
      cwd: runDirectory,
      env: childEnvironment,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Wrangler dry-run failed: ${firstLine(result.stderr || result.stdout)}`,
    );
  }

  const bundlePath = path.join(outputDirectory, "worker.js");
  if (!existsSync(bundlePath) || !existsSync(metafilePath)) {
    throw new Error("Wrangler dry-run did not produce worker.js and its metafile");
  }

  const bundleText = readFileSync(bundlePath, "utf8");
  const metafile = JSON.parse(readFileSync(metafilePath, "utf8"));
  const { inputCount } = validateBundlePolicy({ bundleText, metafile });
  const rawBytes = statSync(bundlePath).size;
  const gzipBytes = gzipSync(Buffer.from(bundleText)).length;

  if (rawBytes > MAX_BUNDLE_BYTES) {
    throw new Error(
      `Worker bundle exceeds the ${MAX_BUNDLE_BYTES}-byte local gate: ${rawBytes}`,
    );
  }

  const dryRunOutput = `${result.stdout}\n${result.stderr}`;
  assert.match(dryRunOutput, /SUPABASE_URL/);
  assert.match(dryRunOutput, /SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(
    dryRunOutput,
    /SERVICE[_-]?ROLE|ADMIN_PASSWORD|CLOUDFLARE_API_TOKEN/i,
  );

  return { rawBytes, gzipBytes, inputCount };
}

async function runWorkerdSmoke({
  wranglerPath,
  wranglerConfig,
  childEnvironment,
  emptyEnvPath,
  runDirectory,
  run,
  expectStaticAssets,
}) {
  const recordedRequests = [];
  const mockServer = http.createServer(
    createMockPostgrestHandler(recordedRequests),
  );
  activeMock = mockServer;
  const mockPort = await listenEphemeral(mockServer);
  const projectTempBefore = listProjectWranglerTempDirectories();
  const cfCacheExisted = existsSync(projectCfCachePath());
  const runStateDirectory = path.join(runDirectory, `state-${run}`);
  let logs = "";
  const results = [];
  let runtimeError = null;

  const wrangler = spawn(
    process.execPath,
    [
      wranglerPath,
      "dev",
      "--local",
      "--config",
      wranglerConfig,
      "--env-file",
      emptyEnvPath,
      "--ip",
      "127.0.0.1",
      "--port",
      "0",
      "--inspector-ip",
      "127.0.0.1",
      "--inspector-port",
      "0",
      "--persist-to",
      runStateDirectory,
      "--show-interactive-dev-session=false",
      "--log-level",
      "info",
      "--var",
      `SUPABASE_URL:http://127.0.0.1:${mockPort}`,
      "--var",
      `SUPABASE_PUBLISHABLE_KEY:${FAKE_PUBLISHABLE_KEY}`,
    ],
    {
      cwd: PROJECT_ROOT,
      env: childEnvironment,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  activeChild = wrangler;
  wrangler.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  wrangler.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });

  try {
    const baseUrl = await waitForReadiness(wrangler, () => logs);

    if (expectStaticAssets) {
      await runStaticAssetChecks(results, baseUrl, run);
    }

    await check(results, "GET /api/health", async () => {
      const before = recordedRequests.length;
      const response = await fetchWithTimeout(`${baseUrl}/api/health`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assertApiSecurityHeaders(response);
      assert.deepEqual(await response.json(), { status: "ok" });
      assert.equal(recordedRequests.length, before);
    });

    await check(results, "full filter search and public RPC request", async () => {
      const before = recordedRequests.length;
      const searchParams = new URLSearchParams({
        q: "насос",
        page: "2",
        category: "hydraulic-pumps",
        subcategory: "gear-pumps",
        brand: "kamaz",
        vehicleType: "samosval",
      });
      const response = await fetchWithTimeout(
        `${baseUrl}/api/catalog/search?${searchParams}`,
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assertApiSecurityHeaders(response);
      assert.deepEqual(await response.json(), {
        items: [EXPECTED_PRODUCT],
        total: 25,
        page: 2,
        pageSize: 24,
        totalPages: 2,
      });

      const calls = recordedRequests.slice(before);
      assert.equal(calls.length, 1);
      const [call] = calls;
      assert.equal(call.method, "POST");
      assert.equal(
        call.url,
        "/rest/v1/rpc/search_catalog_products?offset=24&limit=24",
      );
      assert.equal(call.headers.apikey, FAKE_PUBLISHABLE_KEY);
      assert.equal(call.headers.authorization, undefined);
      assert.equal(call.headers.prefer, "count=exact");
      assert.equal(call.headers.range, undefined);
      assert.equal(call.headers["range-unit"], undefined);
      assert.match(call.headers["content-type"], /^application\/json/);
      assert.deepEqual(call.body, {
        search_query: "насос",
        category_filter: "hydraulic-pumps",
        subcategory_filter: "gear-pumps",
        brand_filter: "kamaz",
        vehicle_type_filter: "samosval",
      });
      assert.deepEqual(
        Object.keys(call.headers).filter((header) =>
          /authorization|cookie|service|secret/i.test(header),
        ),
        [],
      );
    });

    await check(results, "noSubcategory page beyond total", async () => {
      const before = recordedRequests.length;
      const response = await fetchWithTimeout(
        `${baseUrl}/api/catalog/search?q=__twelve__&category=pumps&noSubcategory=1&page=2`,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        items: [],
        total: 12,
        page: 2,
        pageSize: 24,
        totalPages: 1,
      });

      const calls = recordedRequests.slice(before);
      assert.equal(calls.length, 1);
      assert.equal(
        calls[0].url,
        "/rest/v1/rpc/search_catalog_products?offset=24&limit=24",
      );
      assert.equal(calls[0].headers.range, undefined);
      assert.deepEqual(calls[0].body, {
        search_query: "__twelve__",
        category_filter: "pumps",
        subcategory_filter: null,
        brand_filter: null,
        vehicle_type_filter: null,
        require_no_subcategory: true,
      });
    });

    for (const [name, query] of [
      ["subcategory with noSubcategory", "category=pumps&subcategory=gear-pumps&noSubcategory=1"],
      ["ambiguous noSubcategory", "category=pumps&noSubcategory=true"],
    ]) {
      await check(results, `invalid filters: ${name}`, async () => {
        const before = recordedRequests.length;
        const response = await fetchWithTimeout(
          `${baseUrl}/api/catalog/search?${query}`,
        );
        assert.equal(response.status, 400);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assertApiSecurityHeaders(response);
        assert.deepEqual(await response.json(), {
          error: {
            code: "invalid_catalog_search",
            message: "Catalog search filters are invalid",
          },
        });
        assert.equal(recordedRequests.length, before);
      });
    }

    await check(results, "empty first page", async () => {
      const response = await fetchWithTimeout(
        `${baseUrl}/api/catalog/search?q=__empty__`,
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assertApiSecurityHeaders(response);
      assert.deepEqual(await response.json(), {
        items: [],
        total: 0,
        page: 1,
        pageSize: 24,
        totalPages: 1,
      });
    });

    await check(results, "empty page beyond total", async () => {
      const response = await fetchWithTimeout(
        `${baseUrl}/api/catalog/search?q=__empty__&page=3`,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        items: [],
        total: 0,
        page: 3,
        pageSize: 24,
        totalPages: 1,
      });
    });

    await check(results, "page beyond non-empty total", async () => {
      const response = await fetchWithTimeout(
        `${baseUrl}/api/catalog/search?q=__twelve__&page=2`,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        items: [],
        total: 12,
        page: 2,
        pageSize: 24,
        totalPages: 1,
      });
    });

    for (const page of [
      "-7",
      "0",
      "2.5",
      "abc",
      "9007199254740991",
      "1e300",
      "Infinity",
    ]) {
      await check(results, `invalid page ${page}`, async () => {
        const before = recordedRequests.length;
        const response = await fetchWithTimeout(
          `${baseUrl}/api/catalog/search?q=pump&page=${encodeURIComponent(page)}`,
        );
        assert.equal(response.status, 200);
        assert.equal((await response.json()).page, 1);
        const calls = recordedRequests.slice(before);
        assert.equal(calls.length, 1);
        const rpcUrl = new URL(calls[0].url, "http://postgrest.local");
        assert.equal(rpcUrl.searchParams.get("offset"), "0");
        assert.equal(rpcUrl.searchParams.get("limit"), "24");
        assert.equal(calls[0].headers.range, undefined);
      });
    }

    for (const [marker, label] of [
      ["__5xx__", "Supabase 503"],
      ["__no_range__", "missing Content-Range"],
      ["__bad_range__", "malformed Content-Range"],
      ["__inconsistent__", "oversized response"],
      ["__not_json__", "non-JSON response"],
      ["__bad_shape__", "invalid row shape"],
    ]) {
      await check(results, label, async () => {
        const response = await fetchWithTimeout(
          `${baseUrl}/api/catalog/search?q=${marker}`,
        );
        assert.equal(response.status, 502);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assertApiSecurityHeaders(response);
        const responseText = await response.text();
        assert.deepEqual(JSON.parse(responseText), SANITIZED_ERROR);
        assert.doesNotMatch(
          responseText,
          /db-host|secret-internal|PGRST|127\.0\.0\.1/i,
        );
      });
    }

    await check(results, "unknown route", async () => {
      const before = recordedRequests.length;
      const response = await fetchWithTimeout(`${baseUrl}/api/does-not-exist`);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assertApiSecurityHeaders(response);
      assert.deepEqual(await response.json(), {
        error: { code: "not_found", message: "Not found" },
      });
      assert.equal(recordedRequests.length, before);
    });

    for (const route of ["/api/health", "/api/catalog/search"]) {
      await check(results, `POST ${route}`, async () => {
        const before = recordedRequests.length;
        const response = await fetchWithTimeout(`${baseUrl}${route}`, {
          method: "POST",
          body: "{}",
        });
        assert.equal(response.status, 405);
        assert.equal(response.headers.get("allow"), "GET");
        assert.equal(response.headers.get("cache-control"), "no-store");
        assertApiSecurityHeaders(response);
        assert.equal(recordedRequests.length, before);
      });
    }

    await sleep(250);
    await check(results, "sanitized Worker logs", async () => {
      const wranglerFileLogs = existsSync(childEnvironment.WRANGLER_LOG_PATH)
        ? readFileSync(childEnvironment.WRANGLER_LOG_PATH, "utf8")
        : "";
      const explorerApiUrl = parseExplorerApiUrl(`${logs}\n${wranglerFileLogs}`);
      assert.ok(explorerApiUrl, "expected Local Explorer API URL");
      const response = await fetchWithTimeout(
        `${explorerApiUrl}/local/observability/query`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sql: "SELECT level, message FROM logs WHERE level = 'error' LIMIT 200",
          }),
        },
      );
      const responseText = await response.text();
      assert.equal(response.status, 200, responseText);
      assert.match(responseText, /worker api request failed/);
      assert.doesNotMatch(
        responseText,
        /sb_publishable|__5xx__|db-host|secret-internal/i,
      );
      assert.ok(!logs.includes(FAKE_PUBLISHABLE_KEY), "publishable key leaked to logs");
    });
  } catch (error) {
    runtimeError = error;
  } finally {
    const cleanupErrors = [];
    try {
      await stopChildTree(wrangler);
    } catch (error) {
      cleanupErrors.push(error);
    }
    activeChild = null;
    try {
      await closeServer(mockServer);
    } catch (error) {
      cleanupErrors.push(error);
    }
    activeMock = null;
    try {
      removeNewProjectWranglerTempDirectories(projectTempBefore);
      removeNewProjectCfCache(cfCacheExisted);
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (!runtimeError && cleanupErrors.length > 0) {
      runtimeError = new AggregateError(cleanupErrors, "Worker smoke cleanup failed");
    }
  }

  if (runtimeError) throw runtimeError;

  const failures = results.filter((result) => !result.ok);
  for (const result of results) {
    console.log(
      `${result.ok ? "PASS" : "FAIL"} workerd ${run}: ${result.name}${result.error ? ` — ${result.error}` : ""}`,
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `workerd run ${run} failed ${failures.length}/${results.length} checks`,
    );
  }

  return { passed: results.length, total: results.length };
}

async function runStaticAssetChecks(results, baseUrl, run) {
  for (const [route, canonicalPath, marker] of [
    ["/", "/", 'data-static-route="home"'],
    ["/catalog/", "/catalog", 'data-static-route="catalog"'],
    ["/admin/", "/admin", 'data-static-route="admin-shell"'],
  ]) {
    await check(results, `static asset ${route}`, async () => {
      const response = await fetchWithTimeout(`${baseUrl}${route}`, {
        headers: { accept: "text/html" },
      });
      const body = await response.text();
      assert.equal(response.status, 200, body);
      assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
      assert.equal(response.headers.get("x-ayprom-static-prototype"), "asset");
      assert.equal(new URL(response.url).pathname, canonicalPath);
      assert.match(body, new RegExp(marker));
      assert.doesNotMatch(body, /"code":"not_found"/);
    });
  }

  await check(results, "static CSS asset", async () => {
    const response = await fetchWithTimeout(`${baseUrl}/assets/site.css`);
    const body = await response.text();
    assert.equal(response.status, 200, body);
    assert.match(response.headers.get("content-type") ?? "", /^text\/css/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(body, /font-family: system-ui/);
  });

  await check(results, "HTML 404 asset for unknown navigation", async () => {
    const response = await fetchWithTimeout(
      `${baseUrl}/missing-static-navigation-${run}`,
      { headers: { accept: "text/html" } },
    );
    const body = await response.text();
    assert.equal(response.status, 404, body);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
    assert.equal(response.headers.get("x-ayprom-static-prototype"), "asset");
    assert.match(body, /data-static-route="not-found"/);
    assert.doesNotMatch(body, /"code":"not_found"/);
  });

  await check(results, "Worker wins over conflicting /api/health asset", async () => {
    const response = await fetchWithTimeout(`${baseUrl}/api/health`, {
      headers: { accept: "text/html" },
    });
    const body = await response.text();
    assert.equal(response.status, 200, body);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
    assert.equal(response.headers.get("x-ayprom-static-prototype"), null);
    assertApiSecurityHeaders(response);
    assert.deepEqual(JSON.parse(body), { status: "ok" });
    assert.doesNotMatch(body, /api-health-conflict/);
  });
}

function createStaticAssetManifest(rootDirectory) {
  const entries = [];
  const pending = [rootDirectory];

  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`unsupported static asset entry: ${absolutePath}`);
      }
      entries.push({
        path: path.relative(rootDirectory, absolutePath).replaceAll("\\", "/"),
        size: statSync(absolutePath).size,
      });
    }
  }

  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function createMockPostgrestHandler(recordedRequests) {
  return (request, response) => {
    const chunks = [];
    request.on("data", (chunk) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      let body = null;
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = null;
      }

      recordedRequests.push({
        method: request.method,
        url: request.url,
        headers: { ...request.headers },
        body,
      });

      const rpcUrl = new URL(request.url, "http://postgrest.local");
      if (
        request.method !== "POST" ||
        rpcUrl.pathname !== "/rest/v1/rpc/search_catalog_products"
      ) {
        return sendJson(response, 404, {
          code: "PGRST202",
          message: "mock: unexpected route",
        });
      }

      const query = body?.search_query ?? "";
      const from = Number(rpcUrl.searchParams.get("offset"));
      const limit = Number(rpcUrl.searchParams.get("limit"));

      if (
        !Number.isSafeInteger(from) ||
        from < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1
      ) {
        return sendJson(response, 400, {
          code: "PGRST100",
          message: "mock: invalid limit/offset",
        });
      }

      switch (query) {
        case "__empty__":
          if (from > 0) {
            return sendJson(response, 416, '{"code":"PGRST103","details":"An off', {
              "content-range": "*/0",
            });
          }
          return sendJson(response, 200, [], { "content-range": "*/0" });
        case "__twelve__":
          if (from > 12) {
            return sendJson(response, 416, { code: "PGRST103" }, {
              "content-range": "*/12",
            });
          }
          if (from === 12) {
            return sendJson(response, 206, [], { "content-range": "*/12" });
          }
          return sendJson(response, 206, [SEARCH_ROW], {
            "content-range": `${from}-${from}/12`,
          });
        case "__5xx__":
          return sendJson(
            response,
            503,
            "db-host=internal.example secret-internal-detail",
          );
        case "__no_range__":
          return sendJson(response, 200, [SEARCH_ROW]);
        case "__bad_range__":
          return sendJson(response, 200, [SEARCH_ROW], {
            "content-range": "0-0/*",
          });
        case "__inconsistent__":
          return sendJson(
            response,
            206,
            Array.from({ length: 30 }, () => SEARCH_ROW),
            { "content-range": `${from}-${from + 29}/999` },
          );
        case "__not_json__":
          response.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "content-range": "0-0/1",
          });
          response.end("<html>oops</html>");
          return;
        case "__bad_shape__":
          return sendJson(response, 200, [{ slug: "missing-fields" }], {
            "content-range": "0-0/1",
          });
        default:
          return sendJson(response, 206, [SEARCH_ROW], {
            "content-range": `${from}-${from}/25`,
          });
      }
    });
  };
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(typeof payload === "string" ? payload : JSON.stringify(payload));
}

async function waitForReadiness(child, getLogs) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let earlyExit = null;
  child.once("exit", (code, signal) => {
    earlyExit = { code, signal };
  });

  while (Date.now() < deadline) {
    if (earlyExit) {
      throw new Error(
        `Wrangler exited before readiness (${earlyExit.code ?? earlyExit.signal}):\n${formatLogsForError(getLogs())}`,
      );
    }

    const readyUrl = parseReadyUrl(getLogs());
    if (readyUrl) {
      try {
        const response = await fetchWithTimeout(`${readyUrl}/api/health`);
        if (response.status === 200) return readyUrl;
      } catch {
        // The ready line can arrive slightly before the first accepted request.
      }
    }
    await sleep(150);
  }

  throw new Error(
    `Wrangler did not become ready in ${READY_TIMEOUT_MS}ms:\n${formatLogsForError(getLogs())}`,
  );
}

// Ответ Worker обязан нести защитные заголовки сам. Маркер статического
// `_headers` при этом отсутствует: `_headers` к ответам Worker не применяется
// (в режиме Static Assets это проверяется на реальном workerd).
function assertApiSecurityHeaders(response) {
  for (const [name, value] of Object.entries(EXPECTED_API_SECURITY_HEADERS)) {
    assert.equal(response.headers.get(name), value, name);
  }
  assert.equal(response.headers.get("x-ayprom-static-prototype"), null);
}

async function check(results, name, assertion) {
  try {
    await assertion();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({
      name,
      ok: false,
      error: error instanceof Error ? firstLine(error.message) : String(error),
    });
  }
}

function fetchWithTimeout(url, init = {}) {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

function listenEphemeral(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Mock PostgREST did not expose a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

async function closeServer(server) {
  if (!server?.listening) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

async function stopChildTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));

  if (process.platform === "win32") {
    child.kill();
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // The process group already exited.
    }
  }

  if (await settlesWithin(exited, PROCESS_STOP_TIMEOUT_MS)) {
    if (process.platform === "win32") await sleep(2_000);
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // The process group already exited.
    }
  }

  if (!(await settlesWithin(exited, PROCESS_STOP_TIMEOUT_MS))) {
    throw new Error(`Wrangler process tree ${child.pid} did not exit`);
  }
  if (process.platform === "win32") await sleep(2_000);
}

function projectCfCachePath() {
  return path.join(PROJECT_ROOT, ".wrangler", "cache", "cf.json");
}

function removeNewProjectCfCache(existedBefore) {
  const cachePath = path.resolve(projectCfCachePath());
  if (existedBefore || !existsSync(cachePath)) return;

  const expectedCacheDirectory = path.resolve(
    PROJECT_ROOT,
    ".wrangler",
    "cache",
  );
  if (
    path.dirname(cachePath) !== expectedCacheDirectory ||
    path.basename(cachePath) !== "cf.json"
  ) {
    throw new Error(`Refusing unexpected Wrangler cache cleanup: ${cachePath}`);
  }

  rmSync(cachePath, { force: true });
  if (readdirSync(expectedCacheDirectory).length === 0) {
    rmSync(expectedCacheDirectory, { force: true });
  }
}

function listProjectWranglerTempDirectories() {
  const tempRoot = path.join(PROJECT_ROOT, ".wrangler", "tmp");
  if (!existsSync(tempRoot)) return new Set();
  return new Set(
    readdirSync(tempRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
}

function removeNewProjectWranglerTempDirectories(before) {
  const tempRoot = path.resolve(PROJECT_ROOT, ".wrangler", "tmp");
  if (!existsSync(tempRoot)) return;

  for (const entry of readdirSync(tempRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || before.has(entry.name)) continue;
    if (!/^(?:bundle|dev)-/.test(entry.name)) {
      throw new Error(`Refusing unexpected Wrangler temp cleanup: ${entry.name}`);
    }
    const target = path.resolve(tempRoot, entry.name);
    if (path.dirname(target) !== tempRoot) {
      throw new Error(`Refusing out-of-scope Wrangler cleanup: ${target}`);
    }
    rmSync(target, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
}

function removeVerifiedTempDirectory(directory) {
  if (!existsSync(directory)) return;
  const tempRoot = path.resolve(PROJECT_ROOT, ".wrangler");
  const target = path.resolve(directory);
  if (
    path.dirname(target) !== tempRoot ||
    !path.basename(target).startsWith("smoke-")
  ) {
    throw new Error(`Refusing unexpected smoke temp cleanup: ${target}`);
  }
  rmSync(target, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}

async function stopActiveRuntime() {
  const child = activeChild;
  const mock = activeMock;
  activeChild = null;
  activeMock = null;
  await stopChildTree(child);
  await closeServer(mock);
}

async function emergencyExit(code, message) {
  console.error(message);
  try {
    await stopActiveRuntime();
    if (activeTempDirectory) removeVerifiedTempDirectory(activeTempDirectory);
  } finally {
    process.exit(code);
  }
}

function settlesWithin(promise, timeoutMs) {
  return Promise.race([
    promise.then(() => true),
    sleep(timeoutMs).then(() => false),
  ]);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function firstLine(value) {
  return String(value ?? "").split(/\r?\n/, 1)[0];
}

function formatLogsForError(value) {
  return String(value ?? "")
    .replaceAll(FAKE_PUBLISHABLE_KEY, "[redacted-publishable-key]")
    .replace(/\u001B\[[0-9;]*m/g, "")
    .slice(-8_000);
}
