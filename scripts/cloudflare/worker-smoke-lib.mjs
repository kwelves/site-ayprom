const SENSITIVE_ENV_PREFIX =
  /^(?:CLOUDFLARE_|CF_|SUPABASE_|NEXT_PUBLIC_SUPABASE_|WRANGLER_)/i;

const EXPECTED_BUNDLE_INPUTS = [
  "src/cloudflare/supabase-catalog-search.ts",
  "src/cloudflare/worker-api.ts",
  "src/cloudflare/worker.ts",
  "src/lib/catalog-search-contract.ts",
];

const FORBIDDEN_BUNDLE_MARKERS = [
  /sharp/i,
  /next\//i,
  /@sentry/i,
  /service[_-]?role/i,
  /sb_secret/i,
  /admin_password/i,
  /@supabase\/supabase-js/i,
];

const REQUIRED_STATIC_ASSETS = [
  "index.html",
  "catalog/index.html",
  "admin/index.html",
  "api/health/index.html",
  "404.html",
  "assets/site.css",
];

const MAX_STATIC_ASSET_FILES = 20_000;
const MAX_STATIC_ASSET_BYTES = 25 * 1024 * 1024;
const FORBIDDEN_STATIC_ASSET_PATHS = [
  /(?:^|\/)\.env(?:\.|$)/i,
  /\.map$/i,
  /(?:^|\/)_worker\.js$/i,
  /(?:^|\/)src\//i,
  /(?:^|\/)node_modules\//i,
];

export function buildIsolatedWranglerEnv(sourceEnv, logPath, xdgConfigHome) {
  const isolatedEnv = Object.fromEntries(
    Object.entries(sourceEnv).filter(
      ([key, value]) => value !== undefined && !SENSITIVE_ENV_PREFIX.test(key),
    ),
  );

  return {
    ...isolatedEnv,
    CI: "1",
    NO_COLOR: "1",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_SEND_ERROR_REPORTS: "false",
    WRANGLER_LOG_PATH: logPath,
    XDG_CONFIG_HOME: xdgConfigHome,
  };
}

export function parseReadyUrl(logs) {
  return logs.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/)?.[1] ?? null;
}

export function parseExplorerApiUrl(logs) {
  const matches = Array.from(
    logs.matchAll(
      /Local Explorer API is available at (http:\/\/127\.0\.0\.1:\d+\/cdn-cgi\/local\/explorer\/api)/g,
    ),
  );
  return matches.at(-1)?.[1] ?? null;
}

export function validateBundlePolicy({ bundleText, metafile }) {
  if (!isRecord(metafile) || !isRecord(metafile.inputs)) {
    throw new TypeError("Wrangler metafile does not contain an inputs object");
  }

  const actualInputs = Object.keys(metafile.inputs).map(normalizeBundleInput).sort();
  const expectedInputs = [...EXPECTED_BUNDLE_INPUTS].sort();

  if (
    actualInputs.length !== expectedInputs.length ||
    actualInputs.some((input, index) => input !== expectedInputs[index])
  ) {
    throw new Error(`unexpected bundle inputs: ${actualInputs.join(", ")}`);
  }

  const forbiddenMarker = FORBIDDEN_BUNDLE_MARKERS.find((pattern) =>
    pattern.test(bundleText),
  );
  if (forbiddenMarker) {
    throw new Error(`forbidden marker in Worker bundle: ${forbiddenMarker}`);
  }

  return { inputCount: actualInputs.length };
}

export function validateStaticAssetManifest(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError("static asset manifest must be an array");
  }
  if (entries.length > MAX_STATIC_ASSET_FILES) {
    throw new Error(
      `static asset manifest exceeds ${MAX_STATIC_ASSET_FILES} files`,
    );
  }

  const paths = new Set();
  let totalBytes = 0;
  let maxFileBytes = 0;

  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.path !== "string") {
      throw new TypeError("invalid static asset manifest entry");
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new TypeError(`invalid static asset size: ${entry.path}`);
    }

    const normalizedPath = entry.path.replaceAll("\\", "/");
    if (
      normalizedPath.startsWith("/") ||
      normalizedPath.includes("../") ||
      normalizedPath === ".."
    ) {
      throw new Error(`unsafe static asset path: ${entry.path}`);
    }
    if (FORBIDDEN_STATIC_ASSET_PATHS.some((pattern) => pattern.test(normalizedPath))) {
      throw new Error(`forbidden static asset: ${normalizedPath}`);
    }
    if (entry.size > MAX_STATIC_ASSET_BYTES) {
      throw new Error(`static asset exceeds 25 MiB: ${normalizedPath}`);
    }
    if (paths.has(normalizedPath)) {
      throw new Error(`duplicate static asset: ${normalizedPath}`);
    }

    paths.add(normalizedPath);
    totalBytes += entry.size;
    maxFileBytes = Math.max(maxFileBytes, entry.size);
  }

  for (const requiredPath of REQUIRED_STATIC_ASSETS) {
    if (!paths.has(requiredPath)) {
      throw new Error(`missing required static asset: ${requiredPath}`);
    }
  }

  return { fileCount: entries.length, totalBytes, maxFileBytes };
}

function normalizeBundleInput(input) {
  const normalized = input.replaceAll("\\", "/");
  const expected = EXPECTED_BUNDLE_INPUTS.find(
    (candidate) => normalized === candidate || normalized.endsWith(`/${candidate}`),
  );
  return expected ?? normalized;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
