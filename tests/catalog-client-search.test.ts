import { describe, expect, it, vi } from "vitest";
import {
  CATALOG_CLIENT_SEARCH_ERROR_MESSAGE,
  CatalogClientSearchError,
  buildCatalogPageUrl,
  buildCatalogSearchApiUrl,
  fetchCatalogSearchPage,
  isDefaultCatalogQueryState,
  parseClientCatalogQueryState,
} from "@/lib/catalog-client-search";
import type { ProductPage } from "@/lib/catalog-search-contract";

const SAMPLE_PAGE: ProductPage = {
  items: [
    {
      slug: "nsh-32",
      name: "Насос НШ-32",
      category: "hydraulic-pumps",
      subcategory: "gear-pumps",
      compatibleBrands: [],
      images: [],
      shortDescription: "Описание",
    },
  ],
  total: 1,
  page: 1,
  pageSize: 24,
  totalPages: 1,
};

describe("parseClientCatalogQueryState", () => {
  it("читает q и page из query string", () => {
    expect(parseClientCatalogQueryState("?q=насос&page=3")).toEqual({ query: "насос", page: 3 });
  });

  it("нормализует отсутствующую страницу в 1", () => {
    expect(parseClientCatalogQueryState("")).toEqual({ query: undefined, page: 1 });
    expect(parseClientCatalogQueryState("?q=насос")).toEqual({ query: "насос", page: 1 });
  });

  it.each(["?page=abc", "?page=-3", "?page=0", "?page=1.5"])(
    "нормализует некорректную страницу %s в 1",
    (search) => {
      expect(parseClientCatalogQueryState(search)).toEqual({ query: undefined, page: 1 });
    },
  );

  it("тримит и отбрасывает пустой q", () => {
    expect(parseClientCatalogQueryState("?q=%20%20")).toEqual({ query: undefined, page: 1 });
    expect(parseClientCatalogQueryState("?q=%20насос%20")).toEqual({ query: "насос", page: 1 });
  });

  // Регрессия: эта страница получает category/subcategory из сегментов
  // маршрута, а не из query string, и её клиенту не нужен ни один из
  // остальных публичных параметров поиска (category, subcategory, brand,
  // vehicleType, noSubcategory). Полный parseCatalogSearchParams — контракт
  // публичного API поиска — обязан продолжать строго validировать их (не
  // ослабляем), но клиентский парсер этой страницы обязан их полностью
  // игнорировать, а не наследовать эту строгость и не падать на постороннем
  // мусоре в URL.
  it("игнорирует noSubcategory=bad и другие посторонние параметры вместо падения", () => {
    expect(parseClientCatalogQueryState("?q=насос&page=2&noSubcategory=bad")).toEqual({
      query: "насос",
      page: 2,
    });
  });

  it.each(["true", "0", "", " 1", "yes"])(
    "игнорирует любое значение noSubcategory=%j, не только валидное 1",
    (value) => {
      expect(parseClientCatalogQueryState(`?page=3&noSubcategory=${encodeURIComponent(value)}`)).toEqual({
        query: undefined,
        page: 3,
      });
    },
  );

  it("игнорирует конфликт subcategory + noSubcategory=1, который у публичного API — ошибка", () => {
    expect(
      parseClientCatalogQueryState("?q=насос&subcategory=gear-pumps&noSubcategory=1"),
    ).toEqual({ query: "насос", page: 1 });
  });

  it("игнорирует произвольные неизвестные параметры", () => {
    expect(parseClientCatalogQueryState("?q=насос&page=2&utm_source=ads&foo=bar")).toEqual({
      query: "насос",
      page: 2,
    });
  });
});

describe("isDefaultCatalogQueryState", () => {
  it("истинно только для пустого запроса и первой страницы", () => {
    expect(isDefaultCatalogQueryState({ query: undefined, page: 1 })).toBe(true);
    expect(isDefaultCatalogQueryState({ query: "насос", page: 1 })).toBe(false);
    expect(isDefaultCatalogQueryState({ query: undefined, page: 2 })).toBe(false);
  });
});

describe("buildCatalogPageUrl (реэкспорт pageHref)", () => {
  it("строит тот же URL, что серверная пагинация", () => {
    expect(buildCatalogPageUrl("/catalog/category/pumps/subcategory/gear-pumps", 1)).toBe(
      "/catalog/category/pumps/subcategory/gear-pumps",
    );
    expect(buildCatalogPageUrl("/catalog/category/pumps/subcategory/gear-pumps", 2, "насос")).toBe(
      "/catalog/category/pumps/subcategory/gear-pumps?q=%D0%BD%D0%B0%D1%81%D0%BE%D1%81&page=2",
    );
  });
});

describe("buildCatalogSearchApiUrl", () => {
  it("строит запрос к публичному Worker API с category/subcategory", () => {
    expect(
      buildCatalogSearchApiUrl(
        { categorySlug: "hydraulic-pumps", subcategorySlug: "gear-pumps" },
        { query: "насос", page: 2 },
      ),
    ).toBe("/api/catalog/search?category=hydraulic-pumps&subcategory=gear-pumps&q=%D0%BD%D0%B0%D1%81%D0%BE%D1%81&page=2");
  });

  it("опускает q, когда запроса нет", () => {
    expect(
      buildCatalogSearchApiUrl({ categorySlug: "hydraulic-pumps" }, { query: undefined, page: 1 }),
    ).toBe("/api/catalog/search?category=hydraulic-pumps&page=1");
  });

  // Смешанная категория (/catalog/category/[slug], category.type ===
  // "subcategory", прямые товары без подкатегории): пагинирует их тем же
  // публичным Worker API, что и остальные страницы, через noSubcategory=1 —
  // тот же ключ, что уже принимает search_catalog_products.
  it("добавляет noSubcategory=1, когда передан withoutSubcategory", () => {
    expect(
      buildCatalogSearchApiUrl(
        { categorySlug: "hydraulic-pumps", withoutSubcategory: true },
        { query: undefined, page: 2 },
      ),
    ).toBe("/api/catalog/search?category=hydraulic-pumps&noSubcategory=1&page=2");
  });

  it("не добавляет noSubcategory, когда withoutSubcategory не передан или ложен", () => {
    expect(
      buildCatalogSearchApiUrl(
        { categorySlug: "hydraulic-pumps", withoutSubcategory: false },
        { query: undefined, page: 1 },
      ),
    ).toBe("/api/catalog/search?category=hydraulic-pumps&page=1");
  });
});

describe("fetchCatalogSearchPage", () => {
  it("возвращает ProductPage при успешном ответе", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_PAGE), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(fetchCatalogSearchPage("/api/catalog/search?category=pumps", { fetchImpl })).resolves.toEqual(
      SAMPLE_PAGE,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/catalog/search?category=pumps",
      expect.objectContaining({ headers: expect.objectContaining({ accept: "application/json" }) }),
    );
  });

  it("бросает единственное безопасное сообщение при HTTP-ошибке, не раскрывая тело ответа", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("internal db host leaked here", { status: 502 }),
    );

    const error = await fetchCatalogSearchPage("/api/catalog/search", { fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CatalogClientSearchError);
    expect((error as Error).message).toBe(CATALOG_CLIENT_SEARCH_ERROR_MESSAGE);
  });

  it("бросает безопасное сообщение на нечитаемый JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("<html>oops</html>", { status: 200, headers: { "content-type": "application/json" } }),
    );

    await expect(fetchCatalogSearchPage("/api/catalog/search", { fetchImpl })).rejects.toBeInstanceOf(
      CatalogClientSearchError,
    );
  });

  it("бросает безопасное сообщение на форму ответа без нужных полей", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    );

    await expect(fetchCatalogSearchPage("/api/catalog/search", { fetchImpl })).rejects.toBeInstanceOf(
      CatalogClientSearchError,
    );
  });

  it("бросает безопасное сообщение при сетевой ошибке", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("network down"));

    await expect(fetchCatalogSearchPage("/api/catalog/search", { fetchImpl })).rejects.toBeInstanceOf(
      CatalogClientSearchError,
    );
  });

  it("пробрасывает AbortError без оборачивания, чтобы вызывающий код мог его тихо проглотить", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const fetchImpl = vi.fn().mockRejectedValue(abortError);

    await expect(fetchCatalogSearchPage("/api/catalog/search", { fetchImpl })).rejects.toBe(abortError);
  });
});
