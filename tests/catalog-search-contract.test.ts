import { describe, expect, it } from "vitest";
import {
  buildCatalogSearchPage,
  CatalogSearchFilterError,
  createCatalogSearchRequest,
  parseCatalogSearchParams,
} from "@/lib/catalog-search-contract";

const ORDINARY_RPC_KEYS = [
  "search_query",
  "category_filter",
  "subcategory_filter",
  "brand_filter",
  "vehicle_type_filter",
];

describe("режим «только товары без подкатегории»", () => {
  it("добавляет require_no_subcategory только во включённом режиме", () => {
    const request = createCatalogSearchRequest({
      categorySlug: "pumps",
      withoutSubcategory: true,
      page: 2,
    });

    expect(request).toEqual({
      page: 2,
      pageSize: 24,
      from: 24,
      to: 47,
      rpcArgs: {
        search_query: null,
        category_filter: "pumps",
        subcategory_filter: null,
        brand_filter: null,
        vehicle_type_filter: null,
        require_no_subcategory: true,
      },
    });
  });

  it("сохраняет ровно пять прежних аргументов в обычных запросах", () => {
    for (const filters of [{}, { withoutSubcategory: false }, { categorySlug: "pumps" }]) {
      expect(Object.keys(createCatalogSearchRequest(filters).rpcArgs)).toEqual(ORDINARY_RPC_KEYS);
    }
  });

  it("сохраняет прочие фильтры вместе с новым режимом", () => {
    expect(
      createCatalogSearchRequest({
        query: " насос ",
        categorySlug: "pumps",
        brandSlug: "kamaz",
        vehicleTypeSlug: "samosval",
        withoutSubcategory: true,
      }).rpcArgs,
    ).toEqual({
      search_query: "насос",
      category_filter: "pumps",
      subcategory_filter: null,
      brand_filter: "kamaz",
      vehicle_type_filter: "samosval",
      require_no_subcategory: true,
    });
  });

  it("отвергает одновременный фильтр подкатегории вместо расширения выборки", () => {
    expect(() =>
      createCatalogSearchRequest({
        categorySlug: "pumps",
        subcategorySlug: "gear-pumps",
        withoutSubcategory: true,
      }),
    ).toThrow(CatalogSearchFilterError);
  });

  it("разбирает публичный параметр noSubcategory=1", () => {
    expect(
      parseCatalogSearchParams(
        new URLSearchParams({ category: "pumps", noSubcategory: "1", page: "3" }),
      ),
    ).toEqual({ page: 3, categorySlug: "pumps", withoutSubcategory: true });
  });

  it("не считает slug none признаком режима без подкатегории", () => {
    expect(
      parseCatalogSearchParams(new URLSearchParams({ category: "pumps", subcategory: "none" })),
    ).toEqual({ page: 1, categorySlug: "pumps", subcategorySlug: "none" });
  });

  it.each(["0", "true", "", "yes", " 1"])(
    "отвергает неоднозначное значение noSubcategory=%j",
    (value) => {
      expect(() =>
        parseCatalogSearchParams(new URLSearchParams({ category: "pumps", noSubcategory: value })),
      ).toThrow(CatalogSearchFilterError);
    },
  );

  it("отвергает конфликт subcategory и noSubcategory в URL", () => {
    let caught: unknown;
    try {
      parseCatalogSearchParams(
        new URLSearchParams({ category: "pumps", subcategory: "gear-pumps", noSubcategory: "1" }),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CatalogSearchFilterError);
    expect((caught as CatalogSearchFilterError).code).toBe("conflicting_subcategory_filters");
  });

  it("игнорирует пустой subcategory рядом с noSubcategory=1, как и прежде пустые фильтры", () => {
    expect(
      parseCatalogSearchParams(
        new URLSearchParams({ category: "pumps", subcategory: "  ", noSubcategory: "1" }),
      ),
    ).toEqual({ page: 1, categorySlug: "pumps", withoutSubcategory: true });
  });
});

describe("createCatalogSearchRequest", () => {
  it("создаёт тот же RPC-запрос и диапазон, что текущий каталог", () => {
    expect(createCatalogSearchRequest({})).toEqual({
      page: 1,
      pageSize: 24,
      from: 0,
      to: 23,
      rpcArgs: {
        search_query: null,
        category_filter: null,
        subcategory_filter: null,
        brand_filter: null,
        vehicle_type_filter: null,
      },
    });

    expect(
      createCatalogSearchRequest({
        query: "  насос НШ  ",
        categorySlug: "hydraulic-pumps",
        subcategorySlug: "gear-pumps",
        brandSlug: "kamaz",
        vehicleTypeSlug: "samosval",
        page: 3,
        pageSize: 12,
      }),
    ).toEqual({
      page: 3,
      pageSize: 12,
      from: 24,
      to: 35,
      rpcArgs: {
        search_query: "насос НШ",
        category_filter: "hydraulic-pumps",
        subcategory_filter: "gear-pumps",
        brand_filter: "kamaz",
        vehicle_type_filter: "samosval",
      },
    });
  });

  it("ограничивает размер страницы и исправляет некорректный номер", () => {
    expect(createCatalogSearchRequest({ page: -5, pageSize: 100 })).toMatchObject({
      page: 1,
      pageSize: 48,
      from: 0,
      to: 47,
    });

    for (const page of [1.5, Number.MAX_SAFE_INTEGER, 1e20]) {
      expect(createCatalogSearchRequest({ page })).toMatchObject({
        page: 1,
        pageSize: 24,
        from: 0,
        to: 23,
      });
    }
  });
});

describe("parseCatalogSearchParams", () => {
  it("разбирает публичный URL без сохранения пустых фильтров", () => {
    expect(
      parseCatalogSearchParams(
        new URLSearchParams({
          q: "  насос ",
          page: "2",
          category: "hydraulic-pumps",
          subcategory: "",
          brand: "man",
          vehicleType: "tyagach",
        }),
      ),
    ).toEqual({
      query: "насос",
      page: 2,
      categorySlug: "hydraulic-pumps",
      brandSlug: "man",
      vehicleTypeSlug: "tyagach",
    });
  });

  it("нормализует дробную, нечисловую и небезопасно большую страницу", () => {
    for (const page of ["1.5", "not-a-number", "1e20"]) {
      expect(parseCatalogSearchParams(new URLSearchParams({ page }))).toEqual({ page: 1 });
    }
  });
});

describe("buildCatalogSearchPage", () => {
  it("отвергает отсутствующий или некорректный exact count", () => {
    const request = createCatalogSearchRequest();

    expect(() => buildCatalogSearchPage([], null, request)).toThrow(
      "did not return a valid exact count",
    );
    expect(() => buildCatalogSearchPage([], -1, request)).toThrow(
      "did not return a valid exact count",
    );
  });

  it("преобразует RPC-строки в стабильный JSON-контракт карточек", () => {
    const request = createCatalogSearchRequest({ page: 2, pageSize: 2 });

    expect(
      buildCatalogSearchPage(
        [
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
          {
            slug: "without-photo",
            name: "Товар без фото",
            category_slug: "other",
            subcategory_slug: null,
            short_description: "Описание",
            article: "A-1",
            cover_url: null,
            cover_fallback_url: null,
            cover_scale: null,
            compatible_brands: null,
          },
        ],
        5,
        request,
      ),
    ).toEqual({
      items: [
        {
          slug: "nsh-32",
          name: "Насос НШ-32",
          category: "hydraulic-pumps",
          subcategory: "gear-pumps",
          compatibleBrands: ["kamaz", "maz"],
          images: [
            {
              url: "https://media.example/thumbnail.webp",
              fallbackUrl: "https://media.example/master.png",
              scale: undefined,
            },
          ],
          shortDescription: "Шестерённый насос",
          article: undefined,
        },
        {
          slug: "without-photo",
          name: "Товар без фото",
          category: "other",
          subcategory: undefined,
          compatibleBrands: [],
          images: [],
          shortDescription: "Описание",
          article: "A-1",
        },
      ],
      total: 5,
      page: 2,
      pageSize: 2,
      totalPages: 3,
    });
  });
});
