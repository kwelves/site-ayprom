import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CatalogSearchFilterError,
  createCatalogSearchRequest,
  type CatalogSearchRpcRow,
  type ProductFilters,
} from "@/lib/catalog-search-contract";
import { createCloudflareWorkerApi } from "@/cloudflare/worker-api";
import { createPublicCatalogSearchRpc } from "@/cloudflare/supabase-catalog-search";
import workerEntry from "@/cloudflare/worker";
import { getProducts, getProductsWithoutSubcategory } from "@/lib/queries/products";

const legacySupabase = vi.hoisted(() => ({
  createClient: vi.fn(),
  rpc: vi.fn(),
  range: vi.fn(),
}));

const sentry = vi.hoisted(() => ({
  captureMessage: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: legacySupabase.createClient,
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: sentry.captureMessage,
}));

const SEARCH_ROWS: CatalogSearchRpcRow[] = [
  {
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
  },
];

const EXPECTED_ITEM = {
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

const DIRECT_ROW: CatalogSearchRpcRow = {
  slug: "direct-pump",
  name: "Насос без подкатегории",
  category_slug: "pumps",
  subcategory_slug: null,
  short_description: "Описание",
  article: "P-1",
  cover_url: "https://media.example/direct-thumb.webp",
  cover_fallback_url: "https://media.example/direct.png",
  cover_scale: 1.2,
  compatible_brands: ["kamaz"],
};

const EXPECTED_DIRECT_ITEM = {
  slug: "direct-pump",
  name: "Насос без подкатегории",
  category: "pumps",
  compatibleBrands: ["kamaz"],
  images: [
    {
      url: "https://media.example/direct-thumb.webp",
      fallbackUrl: "https://media.example/direct.png",
      scale: 1.2,
    },
  ],
  shortDescription: "Описание",
  article: "P-1",
};

const ORDINARY_RPC_KEYS = [
  "search_query",
  "category_filter",
  "subcategory_filter",
  "brand_filter",
  "vehicle_type_filter",
];

beforeEach(() => {
  legacySupabase.createClient.mockReset();
  legacySupabase.rpc.mockReset();
  legacySupabase.range.mockReset();
  sentry.captureMessage.mockReset();
  legacySupabase.createClient.mockResolvedValue({ rpc: legacySupabase.rpc });
  legacySupabase.rpc.mockReturnValue({ range: legacySupabase.range });
});

describe("тонкий Cloudflare Worker API", () => {
  it("отвечает на GET /api/health без инфраструктурных зависимостей", async () => {
    const searchRpc = vi.fn();
    const handleRequest = createCloudflareWorkerApi({ searchRpc });

    const response = await handleRequest(new Request("https://worker.test/api/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(searchRpc).not.toHaveBeenCalled();
  });

  it("оставляет реальный Worker health независимым от конфигурации Supabase", async () => {
    const response = await workerEntry.fetch(
      new Request("https://worker.test/api/health"),
      { SUPABASE_URL: "", SUPABASE_PUBLISHABLE_KEY: "" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("возвращает ProductPage и передаёт все фильтры публичному RPC", async () => {
    const searchRpc = vi.fn().mockResolvedValue({ rows: SEARCH_ROWS, count: 25 });
    const handleRequest = createCloudflareWorkerApi({ searchRpc });

    const response = await handleRequest(
      new Request(
        "https://worker.test/api/catalog/search?q=%D0%BD%D0%B0%D1%81%D0%BE%D1%81&page=2&category=hydraulic-pumps&subcategory=gear-pumps&brand=kamaz&vehicleType=samosval",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      items: [EXPECTED_ITEM],
      total: 25,
      page: 2,
      pageSize: 24,
      totalPages: 2,
    });
    expect(searchRpc).toHaveBeenCalledWith({
      page: 2,
      pageSize: 24,
      from: 24,
      to: 47,
      rpcArgs: {
        search_query: "насос",
        category_filter: "hydraulic-pumps",
        subcategory_filter: "gear-pumps",
        brand_filter: "kamaz",
        vehicle_type_filter: "samosval",
      },
    });
  });

  it("возвращает пустой ProductPage при отсутствии совпадений", async () => {
    const handleRequest = createCloudflareWorkerApi({
      searchRpc: vi.fn().mockResolvedValue({ rows: [], count: 0 }),
    });

    const response = await handleRequest(
      new Request("https://worker.test/api/catalog/search?q=missing&page=3"),
    );

    await expect(response.json()).resolves.toEqual({
      items: [],
      total: 0,
      page: 3,
      pageSize: 24,
      totalPages: 1,
    });
  });

  it("нормализует некорректную пагинацию так же, как legacy adapter", async () => {
    const searchRpc = vi.fn().mockResolvedValue({ rows: [], count: 0 });
    const handleRequest = createCloudflareWorkerApi({ searchRpc });

    const response = await handleRequest(
      new Request("https://worker.test/api/catalog/search?page=-7"),
    );

    expect(response.status).toBe(200);
    expect(searchRpc).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 24, from: 0, to: 23 }),
    );
    await expect(response.json()).resolves.toMatchObject({ page: 1, pageSize: 24 });
  });

  it("передаёт noSubcategory=1 публичному RPC вместе с остальными фильтрами", async () => {
    const searchRpc = vi.fn().mockResolvedValue({ rows: [DIRECT_ROW], count: 30 });
    const handleRequest = createCloudflareWorkerApi({ searchRpc });

    const response = await handleRequest(
      new Request(
        "https://worker.test/api/catalog/search?q=pump&category=pumps&brand=kamaz&vehicleType=samosval&noSubcategory=1&page=2",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [EXPECTED_DIRECT_ITEM],
      total: 30,
      page: 2,
      pageSize: 24,
      totalPages: 2,
    });
    expect(searchRpc).toHaveBeenCalledWith({
      page: 2,
      pageSize: 24,
      from: 24,
      to: 47,
      rpcArgs: {
        search_query: "pump",
        category_filter: "pumps",
        subcategory_filter: null,
        brand_filter: "kamaz",
        vehicle_type_filter: "samosval",
        require_no_subcategory: true,
      },
    });
  });

  it.each([
    "category=pumps&subcategory=gear-pumps&noSubcategory=1",
    "category=pumps&noSubcategory=true",
    "category=pumps&noSubcategory=0",
    "category=pumps&noSubcategory=",
  ])("отвечает 400 без обращения к Supabase на некорректный фильтр (%s)", async (query) => {
    const searchRpc = vi.fn();
    const reportError = vi.fn();
    const handleRequest = createCloudflareWorkerApi({ searchRpc, reportError });

    const response = await handleRequest(
      new Request(`https://worker.test/api/catalog/search?${query}`),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_catalog_search",
        message: "Catalog search filters are invalid",
      },
    });
    expect(searchRpc).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("сохраняет exact total для пустой страницы режима без подкатегории (416 */N)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "PGRST103" }), {
        status: 416,
        headers: { "content-type": "application/json", "content-range": "*/7" },
      }),
    );
    const handleRequest = createCloudflareWorkerApi({
      searchRpc: createPublicCatalogSearchRpc(
        {
          SUPABASE_URL: "https://catalog.supabase.co",
          SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
        },
        fetchMock,
      ),
    });

    const response = await handleRequest(
      new Request("https://worker.test/api/catalog/search?category=pumps&noSubcategory=1&page=5"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [],
      total: 7,
      page: 5,
      pageSize: 24,
      totalPages: 1,
    });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get("offset")).toBe("96");
    expect(url.searchParams.get("limit")).toBe("24");
    expect(init.headers).not.toHaveProperty("range");
    expect(JSON.parse(String(init.body))).toMatchObject({
      category_filter: "pumps",
      require_no_subcategory: true,
    });
  });

  it("не раскрывает детали ошибки Supabase", async () => {
    const searchRpc = createPublicCatalogSearchRpc(
      {
        SUPABASE_URL: "https://catalog.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
      },
      vi.fn().mockResolvedValue(
        new Response("database host and internal detail", { status: 503 }),
      ),
    );
    const reportError = vi.fn();
    const handleRequest = createCloudflareWorkerApi({ searchRpc, reportError });

    const response = await handleRequest(
      new Request("https://worker.test/api/catalog/search?q=pump"),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "catalog_search_failed",
        message: "Catalog search is temporarily unavailable",
      },
    });
    expect(reportError).toHaveBeenCalledWith({
      code: "catalog_search_failed",
      route: "/api/catalog/search",
    });
  });
});

describe("публичный Supabase RPC adapter", () => {
  it("вызывает только search_catalog_products с publishable key и exact offset/limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(SEARCH_ROWS), {
        status: 206,
        headers: {
          "content-type": "application/json",
          "content-range": "0-0/25",
        },
      }),
    );
    const searchRpc = createPublicCatalogSearchRpc(
      {
        SUPABASE_URL: "https://catalog.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
      },
      fetchMock,
    );
    const request = createCatalogSearchRequest({ query: "насос", page: 2 });

    await expect(searchRpc(request)).resolves.toEqual({ rows: SEARCH_ROWS, count: 25 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const headers = new Headers(init.headers);
    expect(url.toString()).toBe(
      "https://catalog.supabase.co/rest/v1/rpc/search_catalog_products?offset=24&limit=24",
    );
    expect(init.method).toBe("POST");
    expect(headers.get("apikey")).toBe("sb_publishable_local_test");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("prefer")).toBe("count=exact");
    expect(headers.get("range-unit")).toBeNull();
    expect(headers.get("range")).toBeNull();
    expect(JSON.parse(String(init.body))).toEqual(request.rpcArgs);
    expect(Object.keys(JSON.parse(String(init.body)))).toEqual(ORDINARY_RPC_KEYS);
  });

  it("передаёт require_no_subcategory в теле POST только в новом режиме", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([DIRECT_ROW]), {
        status: 200,
        headers: { "content-type": "application/json", "content-range": "0-0/1" },
      }),
    );
    const searchRpc = createPublicCatalogSearchRpc(
      {
        SUPABASE_URL: "https://catalog.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
      },
      fetchMock,
    );

    await expect(
      searchRpc(createCatalogSearchRequest({ categorySlug: "pumps", withoutSubcategory: true })),
    ).resolves.toEqual({ rows: [DIRECT_ROW], count: 1 });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://catalog.supabase.co/rest/v1/rpc/search_catalog_products?offset=0&limit=24",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      search_query: null,
      category_filter: "pumps",
      subcategory_filter: null,
      brand_filter: null,
      vehicle_type_filter: null,
      require_no_subcategory: true,
    });
  });

  it("считает отсутствующий exact Content-Range ошибкой upstream", async () => {
    const searchRpc = createPublicCatalogSearchRpc(
      {
        SUPABASE_URL: "https://catalog.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
      },
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(SEARCH_ROWS), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(searchRpc(createCatalogSearchRequest())).rejects.toThrow(
      "did not return an exact count",
    );
  });

  it("преобразует PostgREST 416 за пределами exact count в пустую страницу", async () => {
    const searchRpc = createPublicCatalogSearchRpc(
      {
        SUPABASE_URL: "https://catalog.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
      },
      vi.fn().mockResolvedValue(
        new Response('{"code":"PGRST103","details":"An off', {
          status: 416,
          headers: {
            "content-type": "application/json",
            "content-range": "*/0",
          },
        }),
      ),
    );

    await expect(
      searchRpc(createCatalogSearchRequest({ page: 3 })),
    ).resolves.toEqual({ rows: [], count: 0 });
  });

  it("сохраняет exact count из PostgREST 416 для страницы после результата", async () => {
    const searchRpc = createPublicCatalogSearchRpc(
      {
        SUPABASE_URL: "https://catalog.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
      },
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "PGRST103" }), {
          status: 416,
          headers: {
            "content-type": "application/json",
            "content-range": "*/12",
          },
        }),
      ),
    );

    await expect(
      searchRpc(createCatalogSearchRequest({ page: 2 })),
    ).resolves.toEqual({ rows: [], count: 12 });
  });

  it("принимает пустую границу offset равную exact count", async () => {
    const searchRpc = createPublicCatalogSearchRpc(
      {
        SUPABASE_URL: "https://catalog.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
      },
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), {
          status: 206,
          headers: {
            "content-type": "application/json",
            "content-range": "*/12",
          },
        }),
      ),
    );

    await expect(
      searchRpc(createCatalogSearchRequest({ page: 2, pageSize: 12 })),
    ).resolves.toEqual({ rows: [], count: 12 });
  });

  it.each([
    [null, "did not return an exact count"],
    ["*/*", "did not return an exact count"],
    ["*/24", "inconsistent range metadata"],
  ])(
    "отвергает PostgREST 416 с противоречивым Content-Range %s",
    async (contentRange, expectedMessage) => {
      const headers = new Headers({ "content-type": "application/json" });
      if (contentRange) headers.set("content-range", contentRange);
      const searchRpc = createPublicCatalogSearchRpc(
        {
          SUPABASE_URL: "https://catalog.supabase.co",
          SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
        },
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ code: "PGRST103" }), {
            status: 416,
            headers,
          }),
        ),
      );

      await expect(
        searchRpc(createCatalogSearchRequest({ page: 2 })),
      ).rejects.toThrow(expectedMessage);
    },
  );

  it("отвергает противоречивые rows и exact count", async () => {
    const searchRpc = createPublicCatalogSearchRpc(
      {
        SUPABASE_URL: "https://catalog.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
      },
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(SEARCH_ROWS), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-range": "0-0/0",
          },
        }),
      ),
    );

    await expect(searchRpc(createCatalogSearchRequest())).rejects.toThrow(
      "inconsistent range metadata",
    );
  });
});

describe("паритет legacy и Worker adapters", () => {
  it("возвращает идентичный ProductPage", async () => {
    const filters: ProductFilters = {
      query: "насос",
      categorySlug: "hydraulic-pumps",
      subcategorySlug: "gear-pumps",
      brandSlug: "kamaz",
      vehicleTypeSlug: "samosval",
      page: 2,
    };
    legacySupabase.range.mockResolvedValue({ data: SEARCH_ROWS, error: null, count: 25 });
    const worker = createCloudflareWorkerApi({
      searchRpc: vi.fn().mockResolvedValue({ rows: SEARCH_ROWS, count: 25 }),
    });

    const [legacyPage, workerResponse] = await Promise.all([
      getProducts(filters),
      worker(
        new Request(
          "https://worker.test/api/catalog/search?q=%D0%BD%D0%B0%D1%81%D0%BE%D1%81&page=2&category=hydraulic-pumps&subcategory=gear-pumps&brand=kamaz&vehicleType=samosval",
        ),
      ),
    ]);

    expect(JSON.stringify(await workerResponse.json())).toBe(JSON.stringify(legacyPage));
  });

  it.each(["PGRST202", "42883"])(
    "сохраняет legacy fallback для отсутствующего RPC (%s)",
    async (code) => {
      const fallbackQuery = {
        order: vi.fn(),
        limit: vi.fn(),
        range: vi.fn(),
      };
      fallbackQuery.order.mockReturnValue(fallbackQuery);
      fallbackQuery.limit.mockReturnValue(fallbackQuery);
      fallbackQuery.range.mockResolvedValue({
        data: [
          {
            slug: "legacy-product",
            name: "Legacy product",
            category_slug: "other",
            short_description: "Fallback result",
            article: null,
            subcategories: null,
            product_images: [],
            product_brands: [],
          },
        ],
        error: null,
        count: 1,
      });
      const fallbackSelect = vi.fn().mockReturnValue(fallbackQuery);
      const fallbackFrom = vi.fn().mockReturnValue({ select: fallbackSelect });
      legacySupabase.createClient
        .mockResolvedValueOnce({ rpc: legacySupabase.rpc })
        .mockResolvedValueOnce({ from: fallbackFrom });
      legacySupabase.range.mockResolvedValue({
        data: null,
        error: { code, message: "function is missing" },
        count: null,
      });

      await expect(getProducts()).resolves.toMatchObject({
        items: [{ slug: "legacy-product" }],
        total: 1,
        page: 1,
        pageSize: 24,
        totalPages: 1,
      });
      expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
      expect(fallbackFrom).toHaveBeenCalledWith("products");
    },
  );

  it("вызывает обычный RPC ровно с пятью прежними аргументами", async () => {
    legacySupabase.range.mockResolvedValue({ data: SEARCH_ROWS, error: null, count: 1 });

    await getProducts({ categorySlug: "hydraulic-pumps", page: 1 });

    expect(legacySupabase.rpc).toHaveBeenCalledTimes(1);
    const [name, args, options] = legacySupabase.rpc.mock.calls[0];
    expect(name).toBe("search_catalog_products");
    expect(Object.keys(args)).toEqual(ORDINARY_RPC_KEYS);
    expect(options).toEqual({ count: "exact" });
    expect(legacySupabase.range).toHaveBeenCalledWith(0, 23);
  });

  it("возвращает идентичный ProductPage для смешанной категории", async () => {
    legacySupabase.range.mockResolvedValue({ data: [DIRECT_ROW], error: null, count: 30 });
    const workerRpc = vi.fn().mockResolvedValue({ rows: [DIRECT_ROW], count: 30 });
    const worker = createCloudflareWorkerApi({ searchRpc: workerRpc });

    const [legacyPage, workerResponse] = await Promise.all([
      getProductsWithoutSubcategory("pumps", 2),
      worker(
        new Request("https://worker.test/api/catalog/search?category=pumps&noSubcategory=1&page=2"),
      ),
    ]);

    expect(JSON.stringify(await workerResponse.json())).toBe(JSON.stringify(legacyPage));
    expect(legacyPage).toEqual({
      items: [EXPECTED_DIRECT_ITEM],
      total: 30,
      page: 2,
      pageSize: 24,
      totalPages: 2,
    });
    expect(legacySupabase.rpc).toHaveBeenCalledWith(
      "search_catalog_products",
      workerRpc.mock.calls[0][0].rpcArgs,
      { count: "exact" },
    );
    expect(legacySupabase.range).toHaveBeenCalledWith(24, 47);
  });

  it("отвергает конфликт фильтров до обращения к Supabase", async () => {
    await expect(
      getProducts({ categorySlug: "pumps", subcategorySlug: "gear-pumps", withoutSubcategory: true }),
    ).rejects.toBeInstanceOf(CatalogSearchFilterError);
    expect(legacySupabase.rpc).not.toHaveBeenCalled();
  });

  it("пробрасывает прочие ошибки Supabase в режиме без подкатегории", async () => {
    const error = { code: "57014", message: "canceling statement due to statement timeout" };
    legacySupabase.range.mockResolvedValue({ data: null, error, count: null });

    await expect(getProductsWithoutSubcategory("pumps")).rejects.toBe(error);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    expect(legacySupabase.createClient).toHaveBeenCalledTimes(1);
  });

  it.each(["PGRST202", "42883"])(
    "не теряет фильтр без подкатегории в legacy fallback (%s)",
    async (code) => {
      const calls: [string, ...unknown[]][] = [];
      const fallbackResult = {
        data: [
          {
            slug: "direct-pump",
            name: "Насос без подкатегории",
            category_slug: "pumps",
            short_description: "Описание",
            article: "P-1",
            subcategories: null,
            product_images: [],
            product_brands: [{ brand_slug: "kamaz" }],
          },
        ],
        error: null,
        count: 1,
      };
      const builder: Record<string, unknown> = {
        then: (resolve: (value: typeof fallbackResult) => unknown) => resolve(fallbackResult),
      };
      for (const method of ["select", "order", "limit", "range", "eq", "is", "or"]) {
        builder[method] = (...args: unknown[]) => {
          calls.push([method, ...args]);
          return builder;
        };
      }
      const fallbackFrom = vi.fn().mockReturnValue(builder);
      legacySupabase.createClient
        .mockResolvedValueOnce({ rpc: legacySupabase.rpc })
        .mockResolvedValueOnce({ from: fallbackFrom });
      legacySupabase.range.mockResolvedValue({
        data: null,
        error: { code, message: "function is missing" },
        count: null,
      });

      await expect(
        getProducts({
          categorySlug: "pumps",
          brandSlug: "kamaz",
          withoutSubcategory: true,
          page: 2,
        }),
      ).resolves.toEqual({
        items: [
          {
            slug: "direct-pump",
            name: "Насос без подкатегории",
            category: "pumps",
            compatibleBrands: ["kamaz"],
            images: [],
            shortDescription: "Описание",
            article: "P-1",
          },
        ],
        total: 1,
        page: 2,
        pageSize: 24,
        totalPages: 1,
      });
      expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
      expect(fallbackFrom).toHaveBeenCalledWith("products");
      expect(calls).toContainEqual(["is", "subcategory_id", null]);
      expect(calls).toContainEqual(["eq", "category_slug", "pumps"]);
      expect(calls).toContainEqual(["eq", "brand_filter.brand_slug", "kamaz"]);
      expect(calls).toContainEqual(["range", 24, 47]);
      expect(calls.some(([method, value]) => method === "select" && String(value).includes("subcategories!inner"))).toBe(false);
    },
  );

  it("отвергает отсутствующий exact count так же, как Worker", async () => {
    legacySupabase.range.mockResolvedValue({ data: SEARCH_ROWS, error: null, count: null });

    await expect(getProducts()).rejects.toThrow("did not return a valid exact count");
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("не включает fallback для прочих ошибок Supabase", async () => {
    const error = { code: "42501", message: "permission denied" };
    legacySupabase.range.mockResolvedValue({ data: null, error, count: null });

    await expect(getProducts()).rejects.toBe(error);
    expect(legacySupabase.createClient).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });
});
