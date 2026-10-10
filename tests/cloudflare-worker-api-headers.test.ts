import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogSearchRpc } from "@/lib/catalog-search-contract";
import { createCloudflareWorkerApi } from "@/cloudflare/worker-api";

// Контракт защитных заголовков ответов тонкого Worker API. Статические
// `_headers` Cloudflare применяет только к ответам Static Assets, а не к
// ответам самого Worker — поэтому Worker обязан выставлять их сам, на каждом
// классе своих ответов.
//
// Значения, общие с next.config.ts, обязаны совпадать с ним дословно (тест
// паритета ниже читает их оттуда). CSP намеренно отличается: сайтовая CSP —
// политика HTML-документа с origin'ами Supabase/R2 из окружения, а JSON-ответ
// не загружает никаких ресурсов, поэтому для него нужна запретительная
// `default-src 'none'`.
const EXPECTED_SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  "cross-origin-opener-policy": "same-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
};

const EMPTY_PAGE_ROWS = { rows: [], count: 0 };

function expectSecurityHeaders(response: Response) {
  for (const [name, value] of Object.entries(EXPECTED_SECURITY_HEADERS)) {
    expect(response.headers.get(name), name).toBe(value);
  }
}

function handler(searchRpc: CatalogSearchRpc = vi.fn().mockResolvedValue(EMPTY_PAGE_ROWS)) {
  return createCloudflareWorkerApi({ searchRpc, reportError: vi.fn() });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("защитные заголовки ответов Worker API", () => {
  it("GET /api/health", async () => {
    const response = await handler()(new Request("https://worker.test/api/health"));

    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("успешный поиск", async () => {
    const searchRpc = vi.fn().mockResolvedValue({
      rows: [
        {
          slug: "nsh-32",
          name: "Насос НШ-32",
          category_slug: "hydraulic-pumps",
          subcategory_slug: null,
          short_description: "Описание",
          article: null,
          cover_url: null,
          cover_fallback_url: null,
          cover_scale: null,
          compatible_brands: [],
        },
      ],
      count: 1,
    });
    const response = await handler(searchRpc)(new Request("https://worker.test/api/catalog/search?q=a"));

    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("пустой поиск", async () => {
    const response = await handler()(new Request("https://worker.test/api/catalog/search?q=none"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ items: [], total: 0 });
    expectSecurityHeaders(response);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("ошибка клиента 400 (конфликт фильтров)", async () => {
    const response = await handler()(
      new Request("https://worker.test/api/catalog/search?subcategory=a&noSubcategory=1"),
    );

    expect(response.status).toBe(400);
    expectSecurityHeaders(response);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("ошибка upstream 502", async () => {
    const searchRpc = vi.fn().mockRejectedValue(new Error("upstream down"));
    const response = await handler(searchRpc)(new Request("https://worker.test/api/catalog/search?q=a"));

    expect(response.status).toBe(502);
    expectSecurityHeaders(response);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["/api/health", "/api/catalog/search"])("неподдерживаемый метод 405 на %s", async (route) => {
    const response = await handler()(new Request(`https://worker.test${route}`, { method: "POST", body: "{}" }));

    expect(response.status).toBe(405);
    expectSecurityHeaders(response);
    expect(response.headers.get("allow")).toBe("GET");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("неизвестный API-путь 404", async () => {
    const response = await handler()(new Request("https://worker.test/api/does-not-exist"));

    expect(response.status).toBe(404);
    expectSecurityHeaders(response);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("аварийный ответ 500 точки входа Worker (конфигурация недоступна)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    // Обработчик бросает исключение — единственный путь в catch worker.ts.
    vi.doMock("@/cloudflare/worker-api", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/cloudflare/worker-api")>()),
      createCloudflareWorkerApi: () => () => {
        throw new Error("boom");
      },
    }));
    const { default: workerEntry } = await import("@/cloudflare/worker");

    const response = await workerEntry.fetch(
      new Request("https://worker.test/api/health"),
      { SUPABASE_URL: "", SUPABASE_PUBLISHABLE_KEY: "" },
    );
    vi.doUnmock("@/cloudflare/worker-api");

    expect(response.status).toBe(500);
    expectSecurityHeaders(response);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: { code: "worker_configuration_error", message: "Worker configuration is unavailable" },
    });
  });
});

describe("паритет с заголовками next.config.ts", () => {
  it("каждый общий заголовок, кроме CSP, совпадает с next.config.ts дословно", () => {
    // Не импортируем next.config.ts: он подключает Sentry и требует окружения.
    // CSP там — вызов buildContentSecurityPolicy, а не строковый литерал, и
    // по построению в выборку не попадает.
    const source = readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
    const site = new Map<string, string>();
    for (const match of source.matchAll(/key:\s*"([^"]+)",\s*value:\s*"([^"]+)"/g)) {
      site.set(match[1].toLowerCase(), match[2]);
    }

    expect([...site.keys()].sort()).toEqual(
      Object.keys(EXPECTED_SECURITY_HEADERS).filter((name) => name !== "content-security-policy").sort(),
    );
    for (const [name, value] of site) {
      expect(EXPECTED_SECURITY_HEADERS[name], name).toBe(value);
    }
  });
});
