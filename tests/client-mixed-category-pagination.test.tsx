// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientMixedCategoryPagination } from "@/components/catalog/ClientMixedCategoryPagination";
import { CATALOG_CLIENT_SEARCH_ERROR_MESSAGE } from "@/lib/catalog-client-search";
import type { ProductListItem, Subcategory } from "@/types/catalog";
import type { ProductPage } from "@/lib/catalog-search-contract";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element -- изолированный img вместо реального оптимизатора в тесте
  default: ({ alt, ...props }: React.ComponentProps<"img">) => <img alt={alt} {...props} />,
}));

vi.mock("@/lib/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

function subcategory(slug: string, name: string): Subcategory {
  return { slug, name, image: "/sub.svg" };
}

function product(slug: string, overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    slug,
    name: `Товар ${slug}`,
    category: "hydraulic-pumps",
    compatibleBrands: [],
    images: [],
    shortDescription: "Описание",
    ...overrides,
  };
}

function page(overrides: Partial<ProductPage> = {}): ProductPage {
  return {
    items: [product("direct-1")],
    total: 1,
    page: 1,
    pageSize: 24,
    totalPages: 1,
    ...overrides,
  };
}

const BASE_PATH = "/catalog/category/hydraulic-pumps";
const SUBCATEGORIES = [subcategory("gear-pumps", "Шестерённые насосы")];

function setLocation(path: string) {
  window.history.replaceState(null, "", path);
}

function renderAdapter(initial: ProductPage = page(), subcategories: Subcategory[] = SUBCATEGORIES) {
  return render(
    <ClientMixedCategoryPagination
      categorySlug="hydraulic-pumps"
      basePath={BASE_PATH}
      subcategories={subcategories}
      initial={initial}
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

describe("ClientMixedCategoryPagination: начальная страница", () => {
  it("показывает подкатегории и прямые товары страницы 1 без единого fetch", async () => {
    renderAdapter();

    expect(screen.getByText("Шестерённые насосы")).toBeTruthy();
    expect(screen.getByText("Товар direct-1")).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("сохраняет порядок: сначала подкатегории, затем прямые товары", () => {
    renderAdapter(page({ items: [product("direct-1"), product("direct-2")] }));

    const headings = screen.getAllByText(/Шестерённые насосы|Товар direct-/);
    expect(headings.map((node) => node.textContent)).toEqual([
      "Шестерённые насосы",
      "Товар direct-1",
      "Товар direct-2",
    ]);
  });

  it("не показывает поле поиска — этой ветке поиск не добавляется", () => {
    renderAdapter();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("ссылка подкатегории и товара строится из basePath", () => {
    renderAdapter();

    expect(screen.getByRole("link", { name: "Шестерённые насосы" }).getAttribute("href")).toBe(
      "/catalog/category/hydraulic-pumps/subcategory/gear-pumps",
    );
    expect(screen.getByRole("link", { name: "Товар direct-1" }).getAttribute("href")).toBe(
      "/catalog/category/hydraulic-pumps/direct-1",
    );
  });
});

describe("ClientMixedCategoryPagination: пагинация", () => {
  it("клик по «Вперёд» запрашивает noSubcategory=1 и page=2, обновляет URL и грид", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(page({ items: [product("direct-page2")], total: 30, page: 2, totalPages: 2 })),
    );
    renderAdapter(page({ total: 30, page: 1, totalPages: 2 }));

    fireEvent.click(screen.getByRole("link", { name: /вперёд/i }));

    await waitFor(() => expect(screen.getByText("Товар direct-page2")).toBeTruthy());
    // Подкатегории остаются на месте на любой странице — сервер сегодня
    // конкатенирует их перед КАЖДОЙ страницей прямых товаров без изменений.
    expect(screen.getByText("Шестерённые насосы")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/catalog/search?category=hydraulic-pumps&noSubcategory=1&page=2",
      expect.anything(),
    );
    expect(window.location.search).toBe("?page=2");
  });

  it("клик с зажатым Ctrl не перехватывается", async () => {
    renderAdapter(page({ total: 30, page: 1, totalPages: 2 }));

    fireEvent.click(screen.getByRole("link", { name: /вперёд/i }), { ctrlKey: true });

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });
});

describe("ClientMixedCategoryPagination: некорректная страница", () => {
  it("URL с нечисловой page нормализуется в 1 и не делает лишний fetch при монтировании", async () => {
    setLocation(`${BASE_PATH}?page=abc`);
    renderAdapter();

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Товар direct-1")).toBeTruthy();
  });
});

describe("ClientMixedCategoryPagination: пустой результат страницы", () => {
  it("страница за пределами total показывает подкатегории без товаров, не ошибку", async () => {
    setLocation(`${BASE_PATH}?page=2`);
    fetchMock.mockResolvedValueOnce(jsonResponse(page({ items: [], total: 1, page: 2, totalPages: 1 })));
    renderAdapter();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("Шестерённые насосы")).toBeTruthy();
    expect(screen.queryByText(/Товар direct-1/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("ClientMixedCategoryPagination: ошибка API", () => {
  it("показывает единственное безопасное сообщение и позволяет повторить запрос", async () => {
    fetchMock.mockResolvedValueOnce(new Response("internal leak", { status: 502 }));
    setLocation(`${BASE_PATH}?page=2`);
    renderAdapter();

    await waitFor(() => expect(screen.getByText(CATALOG_CLIENT_SEARCH_ERROR_MESSAGE)).toBeTruthy());
    expect(screen.queryByText(/internal leak/)).toBeNull();
    // Подкатегории не зависят от неудавшегося запроса прямых товаров и остаются доступны.
    expect(screen.getByText("Шестерённые насосы")).toBeTruthy();
    // Устаревшие (относящиеся к прошлой успешной странице) прямые товары не показываются рядом с ошибкой.
    expect(screen.queryByText("Товар direct-1")).toBeNull();

    fetchMock.mockResolvedValueOnce(jsonResponse(page({ items: [product("recovered")], page: 2, totalPages: 2 })));
    fireEvent.click(screen.getByRole("button", { name: /повторить/i }));

    await waitFor(() => expect(screen.getByText("Товар recovered")).toBeTruthy());
  });
});

describe("ClientMixedCategoryPagination: устаревший запрос", () => {
  it("игнорирует результат более раннего запроса, пришедший после более нового", async () => {
    let resolveFirst!: (value: Response) => void;
    const firstPromise = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    fetchMock.mockReturnValueOnce(firstPromise);
    fetchMock.mockResolvedValueOnce(jsonResponse(page({ items: [product("third")], page: 3, totalPages: 3 })));
    renderAdapter(page({ total: 60, page: 1, totalPages: 3 }));

    const nav = screen.getByRole("navigation", { name: /страницы каталога/i });
    fireEvent.click(within(nav).getByRole("link", { name: "2" }));
    fireEvent.click(within(nav).getByRole("link", { name: "3" }));

    await waitFor(() => expect(screen.getByText("Товар third")).toBeTruthy());

    await act(async () => {
      resolveFirst(jsonResponse(page({ items: [product("stale-second")], page: 2, totalPages: 3 })));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText("Товар stale-second")).toBeNull();
    expect(screen.getByText("Товар third")).toBeTruthy();
  });
});

describe("ClientMixedCategoryPagination: back/forward", () => {
  it("popstate на базовый путь восстанавливает исходную страницу без нового fetch", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page({ items: [product("page2")], page: 2, totalPages: 2 })));
    renderAdapter(page({ total: 30, totalPages: 2 }));

    fireEvent.click(screen.getByRole("link", { name: /вперёд/i }));
    await waitFor(() => expect(screen.getByText("Товар page2")).toBeTruthy());

    fetchMock.mockClear();
    setLocation(BASE_PATH);
    await act(async () => {
      fireEvent.popState(window);
      await Promise.resolve();
    });

    expect(screen.getByText("Товар direct-1")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("popstate на страницу 2 делает новый fetch", async () => {
    renderAdapter(page({ total: 30, totalPages: 2 }));

    fetchMock.mockResolvedValueOnce(jsonResponse(page({ items: [product("forward")], page: 2, totalPages: 2 })));
    setLocation(`${BASE_PATH}?page=2`);
    await act(async () => {
      fireEvent.popState(window);
    });

    await waitFor(() => expect(screen.getByText("Товар forward")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/catalog/search?category=hydraulic-pumps&noSubcategory=1&page=2",
      expect.anything(),
    );
  });
});
