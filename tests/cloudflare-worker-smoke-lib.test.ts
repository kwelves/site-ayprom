import { describe, expect, it } from "vitest";
import {
  buildIsolatedWranglerEnv,
  parseExplorerApiUrl,
  parseReadyUrl,
  validateStaticAssetManifest,
  validateBundlePolicy,
} from "../scripts/cloudflare/worker-smoke-lib.mjs";

describe("Cloudflare Worker smoke harness helpers", () => {
  it("изолирует Wrangler от реальных Cloudflare и Supabase переменных", () => {
    const env = buildIsolatedWranglerEnv(
      {
        PATH: "C:\\tools",
        CLOUDFLARE_API_TOKEN: "real-cloudflare-token",
        CF_ACCOUNT_ID: "real-account",
        SUPABASE_SERVICE_ROLE_KEY: "real-service-role",
        NEXT_PUBLIC_SUPABASE_URL: "https://production.supabase.co",
        WRANGLER_LOG: "debug",
      },
      "C:\\temp\\wrangler.log",
      "C:\\temp\\xdg-config",
    );

    expect(env).toMatchObject({
      PATH: "C:\\tools",
      CI: "1",
      NO_COLOR: "1",
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_SEND_ERROR_REPORTS: "false",
      WRANGLER_LOG_PATH: "C:\\temp\\wrangler.log",
      XDG_CONFIG_HOME: "C:\\temp\\xdg-config",
    });
    expect(env).not.toHaveProperty("CLOUDFLARE_API_TOKEN");
    expect(env).not.toHaveProperty("CF_ACCOUNT_ID");
    expect(env).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
    expect(env).not.toHaveProperty("NEXT_PUBLIC_SUPABASE_URL");
    expect(env).not.toHaveProperty("WRANGLER_LOG");
  });

  it("извлекает фактический loopback URL из readiness-лога", () => {
    expect(
      parseReadyUrl("[wrangler] Ready on http://127.0.0.1:49152\n"),
    ).toBe("http://127.0.0.1:49152");
    expect(parseReadyUrl("starting workerd")).toBeNull();
  });

  it("извлекает loopback URL Local Explorer для проверки runtime-логов", () => {
    expect(
      parseExplorerApiUrl(
        [
          "Local Explorer API is available at http://127.0.0.1:40001/cdn-cgi/local/explorer/api",
          "Local Explorer API is available at http://127.0.0.1:49153/cdn-cgi/local/explorer/api",
        ].join("\n"),
      ),
    ).toBe("http://127.0.0.1:49153/cdn-cgi/local/explorer/api");
    expect(parseExplorerApiUrl("Starting local server")).toBeNull();
  });

  it("принимает только ожидаемые исходники тонкого Worker bundle", () => {
    expect(
      validateBundlePolicy({
        bundleText: "const worker = { fetch() {} };",
        metafile: {
          inputs: {
            "src/cloudflare/worker.ts": {},
            "src/cloudflare/worker-api.ts": {},
            "src/cloudflare/supabase-catalog-search.ts": {},
            "src/lib/catalog-search-contract.ts": {},
          },
        },
      }),
    ).toEqual({ inputCount: 4 });
  });

  it.each(["sharp", "next/headers", "@sentry/nextjs", "service_role", "sb_secret"])(
    "отвергает запрещённый маркер %s в bundle",
    (marker) => {
      expect(() =>
        validateBundlePolicy({
          bundleText: `const forbidden = ${JSON.stringify(marker)};`,
          metafile: {
            inputs: {
              "src/cloudflare/worker.ts": {},
              "src/cloudflare/worker-api.ts": {},
              "src/cloudflare/supabase-catalog-search.ts": {},
              "src/lib/catalog-search-contract.ts": {},
            },
          },
        }),
      ).toThrow("forbidden marker");
    },
  );

  it("отвергает неожиданную зависимость в metafile", () => {
    expect(() =>
      validateBundlePolicy({
        bundleText: "const worker = true;",
        metafile: {
          inputs: {
            "src/cloudflare/worker.ts": {},
            "src/cloudflare/worker-api.ts": {},
            "src/cloudflare/supabase-catalog-search.ts": {},
            "src/lib/catalog-search-contract.ts": {},
            "node_modules/unexpected/index.js": {},
          },
        },
      }),
    ).toThrow("unexpected bundle inputs");
  });

  it("принимает минимальный asset-first артефакт", () => {
    expect(
      validateStaticAssetManifest([
        { path: "index.html", size: 128 },
        { path: "catalog/index.html", size: 256 },
        { path: "admin/index.html", size: 192 },
        { path: "api/health/index.html", size: 96 },
        { path: "404.html", size: 64 },
        { path: "assets/site.css", size: 48 },
        { path: "_headers", size: 32 },
      ]),
    ).toEqual({ fileCount: 7, totalBytes: 816, maxFileBytes: 256 });
  });

  it.each([
    "index.html",
    "catalog/index.html",
    "admin/index.html",
    "api/health/index.html",
    "404.html",
    "assets/site.css",
  ])("требует обязательный prototype asset %s", (requiredPath) => {
    const complete = [
      { path: "index.html", size: 128 },
      { path: "catalog/index.html", size: 256 },
      { path: "admin/index.html", size: 192 },
      { path: "api/health/index.html", size: 96 },
      { path: "404.html", size: 64 },
      { path: "assets/site.css", size: 48 },
    ];

    expect(() =>
      validateStaticAssetManifest(
        complete.filter((entry) => entry.path !== requiredPath),
      ),
    ).toThrow(`missing required static asset: ${requiredPath}`);
  });

  it.each([
    ".env",
    "assets/app.js.map",
    "_worker.js",
    "src/private.ts",
    "node_modules/package/index.js",
  ])("отвергает запрещённый static asset %s", (forbiddenPath) => {
    expect(() =>
      validateStaticAssetManifest([
        { path: "index.html", size: 1 },
        { path: "catalog/index.html", size: 1 },
        { path: "admin/index.html", size: 1 },
        { path: "api/health/index.html", size: 1 },
        { path: "404.html", size: 1 },
        { path: "assets/site.css", size: 1 },
        { path: forbiddenPath, size: 1 },
      ]),
    ).toThrow("forbidden static asset");
  });

  it("отвергает файл крупнее Cloudflare Static Assets limit", () => {
    expect(() =>
      validateStaticAssetManifest([
        { path: "index.html", size: 25 * 1024 * 1024 + 1 },
        { path: "catalog/index.html", size: 1 },
        { path: "admin/index.html", size: 1 },
        { path: "api/health/index.html", size: 1 },
        { path: "404.html", size: 1 },
        { path: "assets/site.css", size: 1 },
      ]),
    ).toThrow("exceeds 25 MiB");
  });
});
