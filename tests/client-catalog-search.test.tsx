// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientCatalogSearch } from "@/components/catalog/ClientCatalogSearch";
import { CATALOG_CLIENT_SEARCH_ERROR_MESSAGE } from "@/lib/catalog-client-search";
import { getProductHref } from "@/lib/product-href";
import type { ProductListItem } from "@/types/catalog";
import type { ProductPage } from "@/lib/catalog-search-contract";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

vi.mock("@/lib/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

function product(slug: string, overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    slug,
    name: `Товар ${slug}`,
    category: "hydraulic-pumps",
    subcategory: "gear-pumps",
    compatibleBrands: [],
    images: [],
    shortDescription: "Описание",
    ...overrides,
  };
}

function page(overrides: Partial<ProductPage> = {}): ProductPage {
  return {
    items: [product("p1"), product("p2")],
    total: 2,
    page: 1,
    pageSize: 24,
    totalPages: 1,
    ...overrides,
  };
}

const BASE_PATH = "/catalog/category/hydraulic-pumps/subcategory/gear-pumps";

function setLocation(path: string) {
  window.history.replaceState(null, "", path);
}

function renderAdapter(
  initial: ProductPage = page(),
  overrides: Partial<React.ComponentProps<typeof ClientCatalogSearch>> = {},
) {
  return render(
    <ClientCatalogSearch
      categorySlug="hydraulic-pumps"
      subcategorySlug="gear-pumps"
      basePath={BASE_PATH}
      initial={initial}
      scopeLabel="в разделе «Шестерённые насосы»"
      emptyLabel="В этой подкатегории пока нет товаров."
      searchPlaceholder="Поиск по разделу"
      {...overrides}
    />,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  setLocation(BASE_PATH);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("ClientCatalogSearch: начальная страница", () => {
  it("показывает переданные server-baked данные без единого fetch, когда URL совпадает с базовым", async () => {
    renderAdapter();

    expect(screen.getByText("Товар p1")).toBeTruthy();
    expect(screen.getByText("Товар p2")).toBeTruthy();
    // Даём эффекту шанс сработать — не должно ничего запросить.
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("строит ссылку товара из basePath, не из функции-пропа", () => {
    // Регрессия: раньше это был проп-функция productHref, переданная из
    // Server Component в "use client" компонент. Next.js реально отвергает
    // это на границе RSC ("Functions cannot be passed directly to Client
    // Components") — ошибка, которую этот тест (как и все остальные в
    // файле) не увидел бы, потому что jsdom-рендер не проходит через
    // настоящую RSC-сериализацию. Поймано только реальным `next build` +
    // `next start` смоук-тестом; см. комментарий у basePath в
    // ClientCatalogSearchProps.
    renderAdapter();

    const link = screen.getByRole("link", { name: "Товар p1" });
    expect(link.getAttribute("href")).toBe(`${BASE_PATH}/p1`);
  });

  it("использует productBasePath для ссылки товара, когда он отличается от basePath", () => {
    // Страница /catalog/brand/[slug]/category/[categorySlug]/subcategory/[subSlug]:
    // адаптер пагинируется по одному пути, а канонический URL товара — по
    // другому (/catalog/category/[categorySlug]/subcategory/[subSlug]/[slug]).
    // Строковый проп, а не функция — та же причина, что и раньше: функция не
    // пересекает границу Server → "use client" Component.
    const brandBasePath = "/catalog/brand/kamaz/category/hydraulic-pumps/subcategory/gear-pumps";
    const productBasePath = "/catalog/category/hydraulic-pumps/subcategory/gear-pumps";
    renderAdapter(page(), { basePath: brandBasePath, productBasePath });

    const link = screen.getByRole("link", { name: "Товар p1" });
    expect(link.getAttribute("href")).toBe(`${productBasePath}/p1`);
  });

  it("без productBasePath ссылка товара по-прежнему строится из basePath (обратная совместимость)", () => {
    renderAdapter(page(), { basePath: "/catalog/category/hydraulic-pumps/brand/kamaz" });

    const link = screen.getByRole("link", { name: "Товар p1" });
    expect(link.getAttribute("href")).toBe("/catalog/category/hydraulic-pumps/brand/kamaz/p1");
  });
});

describe("ClientCatalogSearch: параметры API для других страниц семейства", () => {
  it("страница brand+category+subcategory передаёт все три фильтра", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page({ items: [product("found")], total: 1, page: 2 })));
    renderAdapter(page({ total: 30, totalPages: 2 }), {
      categorySlug: "hydraulic-pumps",
      subcategorySlug: "gear-pumps",
      brandSlug: "kamaz",
      basePath: "/catalog/brand/kamaz/category/hydraulic-pumps/subcategory/gear-pumps",
      productBasePath: "/catalog/category/hydraulic-pumps/subcategory/gear-pumps",
    });

    fireEvent.click(screen.getByRole("link", { name: /вперёд/i }));

    await waitFor(() => expect(screen.getByText("Товар found")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/catalog/search?category=hydraulic-pumps&subcategory=gear-pumps&brand=kamaz&page=2",
      expect.anything(),
    );

    const link = screen.getByRole("link", { name: "Товар found" });
    expect(link.getAttribute("href")).toBe("/catalog/category/hydraulic-pumps/subcategory/gear-pumps/found");
  });

  it("страница category+brand передаёт category и brand в запросе к Worker", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page({ items: [product("kamaz-pump")], total: 1 })));
    renderAdapter(page(), {
      categorySlug: "hydraulic-pumps",
      subcategorySlug: undefined,
      brandSlug: "kamaz",
      basePath: "/catalog/category/hydraulic-pumps/brand/kamaz",
    });

    const input = screen.getByRole("textbox", { name: /поиск/i });
    fireEvent.change(input, { target: { value: "насос" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(screen.getByText("Товар kamaz-pump")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/catalog/search?category=hydraulic-pumps&brand=kamaz&q=%D0%BD%D0%B0%D1%81%D0%BE%D1%81&page=1",
      expect.anything(),
    );

    const link = screen.getByRole("link", { name: "Товар kamaz-pump" });
    expect(link.getAttribute("href")).toBe("/catalog/category/hydraulic-pumps/brand/kamaz/kamaz-pump");
  });
});

describe("ClientCatalogSearch: поиск", () => {
  it("отправка формы делает fetch, обновляет URL и грид", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page({ items: [product("found")], total: 1 })));
    renderAdapter();

    const input = screen.getByRole("textbox", { name: /поиск/i });
    fireEvent.change(input, { target: { value: "насос" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(screen.getByText("Товар found")).toBeTruthy());

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/catalog/search?category=hydraulic-pumps&subcategory=gear-pumps&q=%D0%BD%D0%B0%D1%81%D0%BE%D1%81&page=1",
      expect.anything(),
    );
    expect(window.location.pathname + window.location.search).toBe(`${BASE_PATH}?q=%D0%BD%D0%B0%D1%81%D0%BE%D1%81`);
  });

  it("пустой запрос ничего не отправляет в Worker и возвращает исходные данные", async () => {
    renderAdapter();

    const input = screen.getByRole("textbox", { name: /поиск/i });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.pathname + window.location.search).toBe(BASE_PATH);
  });
});

describe("ClientCatalogSearch: пагинация", () => {
  it("клик по «Вперёд» делает fetch следующей страницы и обновляет URL", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(page({ items: [product("page2")], total: 50, page: 2, totalPages: 3 })),
    );
    renderAdapter(page({ total: 50, page: 1, totalPages: 3 }));

    fireEvent.click(screen.getByRole("link", { name: /вперёд/i }));

    await waitFor(() => expect(screen.getByText("Товар page2")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/catalog/search?category=hydraulic-pumps&subcategory=gear-pumps&page=2",
      expect.anything(),
    );
    expect(window.location.search).toBe("?page=2");
  });

  it("клик с зажатым Ctrl не перехватывается — реальная навигация в новой вкладке остаётся рабочей", async () => {
    renderAdapter(page({ total: 50, page: 1, totalPages: 3 }));

    const link = screen.getByRole("link", { name: /вперёд/i });
    fireEvent.click(link, { ctrlKey: true });

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });
});

describe("ClientCatalogSearch: пустой результат", () => {
  it("показывает «Ничего не найдено» с возможностью очистить поиск", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page({ items: [], total: 0, totalPages: 1 })));
    renderAdapter();

    const input = screen.getByRole("textbox", { name: /поиск/i });
    fireEvent.change(input, { target: { value: "нет-такого" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(screen.getByText("Ничего не найдено")).toBeTruthy());
    expect(screen.getByText(/нет-такого/)).toBeTruthy();
  });
});

describe("ClientCatalogSearch: посторонние параметры URL", () => {
  it("noSubcategory=bad и прочий мусор в URL не ломают монтирование — q/page всё равно читаются", async () => {
    // Публичный API (parseCatalogSearchParams) обязан строго validировать
    // noSubcategory и конфликт с subcategory — эта страница получает
    // category/subcategory из сегментов маршрута и вообще не использует эти
    // ключи, поэтому клиентский парсер должен их полностью игнорировать, а
    // не наследовать чужую строгость и падать при монтировании.
    setLocation(`${BASE_PATH}?q=насос&noSubcategory=bad`);
    fetchMock.mockResolvedValueOnce(jsonResponse(page({ items: [product("found")], total: 1 })));
    renderAdapter();

    await waitFor(() => expect(screen.getByText("Товар found")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/catalog/search?category=hydraulic-pumps&subcategory=gear-pumps&q=%D0%BD%D0%B0%D1%81%D0%BE%D1%81&page=1",
      expect.anything(),
    );
  });

  it("конфликт subcategory + noSubcategory=1 в URL, ошибочный у публичного API, здесь просто игнорируется", async () => {
    setLocation(`${BASE_PATH}?page=2&subcategory=other&noSubcategory=1`);
    fetchMock.mockResolvedValueOnce(jsonResponse(page({ items: [product("page2")], total: 30, page: 2 })));
    renderAdapter(page({ total: 30, page: 1, totalPages: 2 }));

    await waitFor(() => expect(screen.getByText("Товар page2")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/catalog/search?category=hydraulic-pumps&subcategory=gear-pumps&page=2",
      expect.anything(),
    );
  });
});

describe("ClientCatalogSearch: некорректная страница", () => {
  it("URL с нечисловой page нормализуется в 1 и не делает лишний fetch при монтировании", async () => {
    setLocation(`${BASE_PATH}?page=abc`);
    renderAdapter();

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Товар p1")).toBeTruthy();
  });

  it("URL со страницей за пределами результата запрашивается и показывает пустой ответ Worker как есть", async () => {
    setLocation(`${BASE_PATH}?page=999`);
    fetchMock.mockResolvedValueOnce(jsonResponse(page({ items: [], total: 2, page: 999, totalPages: 1 })));
    renderAdapter();

    await waitFor(() => expect(screen.getByText("Товаров пока нет")).toBeTruthy());
  });
});

describe("ClientCatalogSearch: ошибка API", () => {
  it("показывает единственное безопасное сообщение и позволяет повторить запрос", async () => {
    fetchMock.mockResolvedValueOnce(new Response("internal leak", { status: 502 }));
    renderAdapter();

    const input = screen.getByRole("textbox", { name: /поиск/i });
    fireEvent.change(input, { target: { value: "насос" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(screen.getByText(CATALOG_CLIENT_SEARCH_ERROR_MESSAGE)).toBeTruthy());
    expect(screen.queryByText(/internal leak/)).toBeNull();

    fetchMock.mockResolvedValueOnce(jsonResponse(page({ items: [product("recovered")], total: 1 })));
    fireEvent.click(screen.getByRole("button", { name: /повторить/i }));

    await waitFor(() => expect(screen.getByText("Товар recovered")).toBeTruthy());
  });
});

describe("ClientCatalogSearch: устаревший запрос", () => {
  it("игнорирует результат более раннего запроса, если он приходит после более нового", async () => {
    let resolveFirst!: (value: Response) => void;
    const firstPromise = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    fetchMock.mockReturnValueOnce(firstPromise);
    fetchMock.mockResolvedValueOnce(jsonResponse(page({ items: [product("second")], total: 1 })));
    renderAdapter();

    const input = screen.getByRole("textbox", { name: /поиск/i });
    const form = input.closest("form")!;

    fireEvent.change(input, { target: { value: "первый" } });
    fireEvent.submit(form);

    fireEvent.change(input, { target: { value: "второй" } });
    fireEvent.submit(form);

    await waitFor(() => expect(screen.getByText("Товар second")).toBeTruthy());

    // Первый (устаревший) запрос приходит позже — не должен ничего перезаписать.
    await act(async () => {
      resolveFirst(jsonResponse(page({ items: [product("stale-first")], total: 1 })));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText("Товар stale-first")).toBeNull();
    expect(screen.getByText("Товар second")).toBeTruthy();
  });
});

describe("ClientCatalogSearch: productRouting (кросс-категорийные ссылки для /catalog и vehicle-type)", () => {
  const categoryBrandSlugs = { pto: ["kamaz", "man"] };
  const directProductCategorySlugs = ["filters"];

  function crossProduct(slug: string, overrides: Partial<ProductListItem> = {}): ProductListItem {
    return {
      slug,
      name: `Товар ${slug}`,
      category: "filters",
      compatibleBrands: [],
      images: [],
      shortDescription: "Описание",
      ...overrides,
    };
  }

  function renderCrossCategory(items: ProductListItem[]) {
    return renderAdapter(page({ items, total: items.length }), {
      categorySlug: undefined,
      subcategorySlug: undefined,
      basePath: "/catalog",
      productRouting: { categoryBrandSlugs, directProductCategorySlugs },
    });
  }

  it("товар с подкатегорией ведёт на /catalog/category/[cat]/subcategory/[sub]/[slug], как getProductHref", () => {
    renderCrossCategory([
      crossProduct("with-sub", { category: "hydraulic-pumps", subcategory: "gear-pumps" }),
    ]);

    const link = screen.getByRole("link", { name: "Товар with-sub" });
    expect(link.getAttribute("href")).toBe("/catalog/category/hydraulic-pumps/subcategory/gear-pumps/with-sub");
  });

  it("товар прямой категории (directProductCategorySlugs) ведёт на /catalog/category/[cat]/[slug]", () => {
    renderCrossCategory([crossProduct("direct-1", { category: "filters" })]);

    const link = screen.getByRole("link", { name: "Товар direct-1" });
    expect(link.getAttribute("href")).toBe("/catalog/category/filters/direct-1");
  });

  it("multi-brand товар выбирает бренд ровно как getProductHref, вызванный напрямую", () => {
    renderCrossCategory([crossProduct("shaft", { category: "pto", compatibleBrands: ["man", "kamaz"] })]);

    const link = screen.getByRole("link", { name: "Товар shaft" });
    expect(link.getAttribute("href")).toBe(
      getProductHref(
        crossProduct("shaft", { category: "pto", compatibleBrands: ["man", "kamaz"] }),
        categoryBrandSlugs,
        new Set(directProductCategorySlugs),
      ),
    );
  });

  it("товар без подкатегории/бренда/прямой категории — безопасный fallback на /catalog", () => {
    renderCrossCategory([crossProduct("orphan", { category: "unknown" })]);

    const link = screen.getByRole("link", { name: "Товар orphan" });
    expect(link.getAttribute("href")).toBe("/catalog");
  });

  it("без productRouting поведение basePath/productBasePath не меняется (регрессия)", () => {
    renderAdapter(page({ items: [crossProduct("legacy")] }), {
      categorySlug: undefined,
      subcategorySlug: undefined,
      basePath: "/catalog",
    });

    const link = screen.getByRole("link", { name: "Товар legacy" });
    expect(link.getAttribute("href")).toBe("/catalog/legacy");
  });

  it("после получения новых результатов (поиск) ссылки по-прежнему строятся через productRouting", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(page({ items: [crossProduct("fetched", { category: "filters" })], total: 1 })),
    );
    renderAdapter(page({ items: [], total: 0 }), {
      categorySlug: undefined,
      subcategorySlug: undefined,
      basePath: "/catalog",
      productRouting: { categoryBrandSlugs, directProductCategorySlugs },
    });

    const input = screen.getByRole("textbox", { name: /поиск/i });
    fireEvent.change(input, { target: { value: "фильтр" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(screen.getByText("Товар fetched")).toBeTruthy());
    const link = screen.getByRole("link", { name: "Товар fetched" });
    expect(link.getAttribute("href")).toBe("/catalog/category/filters/fetched");
  });

  it("после перехода на следующую страницу (пагинация) ссылки тоже строятся через productRouting", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        page({ items: [crossProduct("page2-item", { category: "filters" })], total: 30, page: 2, totalPages: 2 }),
      ),
    );
    renderAdapter(page({ items: [crossProduct("page1-item")], total: 30, page: 1, totalPages: 2 }), {
      categorySlug: undefined,
      subcategorySlug: undefined,
      basePath: "/catalog",
      productRouting: { categoryBrandSlugs, directProductCategorySlugs },
    });

    fireEvent.click(screen.getByRole("link", { name: /вперёд/i }));

    await waitFor(() => expect(screen.getByText("Товар page2-item")).toBeTruthy());
    const link = screen.getByRole("link", { name: "Товар page2-item" });
    expect(link.getAttribute("href")).toBe("/catalog/category/filters/page2-item");
  });
});

describe("ClientCatalogSearch: back/forward", () => {
  it("popstate синхронизирует грид с URL и восстанавливает исходные данные без нового fetch на базовом пути", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page({ items: [product("searched")], total: 1 })));
    renderAdapter();

    const input = screen.getByRole("textbox", { name: /поиск/i });
    fireEvent.change(input, { target: { value: "насос" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(screen.getByText("Товар searched")).toBeTruthy());

    // Имитируем нажатие "назад" браузером: URL меняется на базовый.
    fetchMock.mockClear();
    setLocation(BASE_PATH);
    await act(async () => {
      fireEvent.popState(window);
      await Promise.resolve();
    });

    expect(screen.getByText("Товар p1")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("popstate на непустой запрос делает новый fetch", async () => {
    renderAdapter();

    fetchMock.mockResolvedValueOnce(jsonResponse(page({ items: [product("forward")], total: 1, page: 2 })));
    setLocation(`${BASE_PATH}?page=2`);
    await act(async () => {
      fireEvent.popState(window);
    });

    await waitFor(() => expect(screen.getByText("Товар forward")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/catalog/search?category=hydraulic-pumps&subcategory=gear-pumps&page=2",
      expect.anything(),
    );
  });
});
