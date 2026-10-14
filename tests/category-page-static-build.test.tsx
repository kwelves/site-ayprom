// @vitest-environment jsdom
//
// Guards the branch boundaries inside
// src/app/(site)/catalog/category/[slug]/page.tsx. Two branches get a
// static-build client adapter: category.type === null (ClientCatalogSearch,
// search + pagination) and the mixed subcategory+direct-product fallback
// branch (ClientMixedCategoryPagination, pagination only — no search box is
// added there). The "brand" branch renders exactly as before regardless of
// AYPROM_STATIC_BUILD (it never reads searchParams at all), and normal
// (non-static) rendering of every branch must keep using real server-side
// search/pagination, unchanged.
//
// STATIC_BUILD is read as a module-level constant at import time
// (`process.env.AYPROM_STATIC_BUILD === "1"`), so each *describe* block
// resets the module registry and re-imports the page once, in `beforeAll`
// — not once per `it`. Every test in a describe block wants the same
// STATIC_BUILD value, so re-importing per test only cost CPU time; under
// worker contention (e.g. `--maxWorkers=2` with other test files running
// concurrently) that extra time could push a test's `await importPage()`
// past its own timeout. Vitest's per-test timeout doesn't cancel in-flight
// async work — the dangling test keeps running in the background and can
// call `render()` well after the runner has moved on, landing a second,
// uncleaned tree in the document at the same time as a later test's own
// render (surfaced as "multiple elements found" for a later test, not as a
// visible failure on the slow test itself). Importing once per describe
// removes the repeated expensive step entirely instead of just tolerating
// it.

import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Category, Subcategory, Brand } from "@/types/catalog";
import type { ProductPage } from "@/lib/catalog-search-contract";

const router = { back: vi.fn(), replace: vi.fn(), push: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  notFound: vi.fn(() => {
    throw new Error("unexpected notFound() call in a found-category test");
  }),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

vi.mock("@/lib/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

const queries = vi.hoisted(() => ({
  getCategory: vi.fn(),
  getCategories: vi.fn(),
  getSubcategories: vi.fn(),
  getCategoryBrands: vi.fn(),
  getProducts: vi.fn(),
  getProductsWithoutSubcategory: vi.fn(),
}));

vi.mock("@/lib/queries/categories", () => ({
  getCategory: queries.getCategory,
  getCategories: queries.getCategories,
}));
vi.mock("@/lib/queries/subcategories", () => ({
  getSubcategories: queries.getSubcategories,
}));
vi.mock("@/lib/queries/category-brands", () => ({
  getCategoryBrands: queries.getCategoryBrands,
}));
vi.mock("@/lib/queries/products", () => ({
  getProducts: queries.getProducts,
  getProductsWithoutSubcategory: queries.getProductsWithoutSubcategory,
  parseCatalogPage: (value?: string) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  },
}));

function directCategory(overrides: Partial<Category> = {}): Category {
  return {
    slug: "filters",
    name: "Фильтры",
    description: "",
    icon: "hydraulic-pump",
    image: "/cat.svg",
    type: null,
    ...overrides,
  };
}

function brandCategory(overrides: Partial<Category> = {}): Category {
  return { ...directCategory({ slug: "pto", name: "КОМ", type: "brand" }), ...overrides };
}

function subcategoryTypeCategory(overrides: Partial<Category> = {}): Category {
  return { ...directCategory({ slug: "hydraulic-pumps", name: "Гидронасосы", type: "subcategory" }), ...overrides };
}

function emptyProductPage(overrides: Partial<ProductPage> = {}): ProductPage {
  return {
    items: [
      {
        slug: "filter-1",
        name: "Фильтр гидравлический",
        category: "filters",
        compatibleBrands: [],
        images: [],
        shortDescription: "Описание",
      },
    ],
    total: 1,
    page: 1,
    pageSize: 24,
    totalPages: 1,
    ...overrides,
  };
}

async function importPage(staticBuild: boolean) {
  vi.resetModules();
  if (staticBuild) {
    process.env.AYPROM_STATIC_BUILD = "1";
  } else {
    delete process.env.AYPROM_STATIC_BUILD;
  }
  return import("@/app/(site)/catalog/category/[slug]/page");
}

function searchParamsFor(q?: string, page?: string) {
  return Promise.resolve({ q, page });
}

beforeEach(() => {
  queries.getCategory.mockReset();
  queries.getCategories.mockReset().mockResolvedValue([]);
  queries.getSubcategories.mockReset().mockResolvedValue([]);
  queries.getCategoryBrands.mockReset().mockResolvedValue([]);
  queries.getProducts.mockReset();
  queries.getProductsWithoutSubcategory.mockReset();
  router.back.mockReset();
  router.replace.mockReset();
  router.push.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("category.type === null: static-build режим", () => {
  let CategoryPage: Awaited<ReturnType<typeof importPage>>["default"];

  beforeAll(async () => {
    ({ default: CategoryPage } = await importPage(true));
  });

  afterAll(() => {
    delete process.env.AYPROM_STATIC_BUILD;
  });

  it("монтирует ClientCatalogSearch, замораживая страницу 1 без q/page от запроса", async () => {
    const category = directCategory();
    queries.getCategory.mockResolvedValue(category);
    queries.getProducts.mockResolvedValue(emptyProductPage());

    const element = await CategoryPage({
      params: Promise.resolve({ slug: "filters" }),
      // Реальный запрос несёт q/page — static-режим обязан их игнорировать.
      searchParams: searchParamsFor("посторонний-запрос", "5"),
    });
    render(element);

    // Уникальный маркер ClientCatalogSearch: живой aria-live статус, которого
    // нет ни у ProductSearchForm, ни у ProductGridWithSearch.
    expect(screen.getByRole("status")).toBeTruthy();
    expect(queries.getProducts).toHaveBeenCalledWith({ categorySlug: "filters" });
    expect(queries.getProducts).not.toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.anything() }),
    );
  });

  it("ссылка товара остаётся /catalog/category/[slug]/[productSlug]", async () => {
    const category = directCategory();
    queries.getCategory.mockResolvedValue(category);
    queries.getProducts.mockResolvedValue(emptyProductPage());

    const element = await CategoryPage({
      params: Promise.resolve({ slug: "filters" }),
      searchParams: searchParamsFor(),
    });
    render(element);

    const link = screen.getByRole("link", { name: "Фильтр гидравлический" });
    expect(link.getAttribute("href")).toBe("/catalog/category/filters/filter-1");
  });
});

describe("category.type === null: обычный режим не меняется", () => {
  let CategoryPage: Awaited<ReturnType<typeof importPage>>["default"];

  beforeAll(async () => {
    ({ default: CategoryPage } = await importPage(false));
  });

  it("не монтирует ClientCatalogSearch и передаёт реальные q/page в getProducts", async () => {
    const category = directCategory();
    queries.getCategory.mockResolvedValue(category);
    queries.getProducts.mockResolvedValue(emptyProductPage());

    const element = await CategoryPage({
      params: Promise.resolve({ slug: "filters" }),
      searchParams: searchParamsFor("насос", "2"),
    });
    render(element);

    expect(screen.queryByRole("status")).toBeNull();
    expect(queries.getProducts).toHaveBeenCalledWith({
      categorySlug: "filters",
      query: "насос",
      page: 2,
    });
  });
});

describe("category.type === \"brand\": граница не расширяется", () => {
  let CategoryPage: Awaited<ReturnType<typeof importPage>>["default"];

  beforeAll(async () => {
    ({ default: CategoryPage } = await importPage(true));
  });

  afterAll(() => {
    delete process.env.AYPROM_STATIC_BUILD;
  });

  it("остаётся веткой карточек брендов даже при AYPROM_STATIC_BUILD=1", async () => {
    const category = brandCategory();
    queries.getCategory.mockResolvedValue(category);
    queries.getCategoryBrands.mockResolvedValue([
      { slug: "man", name: "MAN", country: "DE", logo: "/man.svg" } satisfies Brand,
    ]);

    const element = await CategoryPage({
      params: Promise.resolve({ slug: "pto" }),
      searchParams: searchParamsFor(),
    });
    render(element);

    expect(screen.queryByRole("status")).toBeNull();
    expect(queries.getProducts).not.toHaveBeenCalled();
    expect(screen.getByText("MAN")).toBeTruthy();
  });
});

describe("category.type === \"subcategory\" (смешанная категория): static-build режим", () => {
  let CategoryPage: Awaited<ReturnType<typeof importPage>>["default"];

  beforeAll(async () => {
    ({ default: CategoryPage } = await importPage(true));
  });

  afterAll(() => {
    delete process.env.AYPROM_STATIC_BUILD;
  });

  it("монтирует ClientMixedCategoryPagination, замораживая страницу 1 прямых товаров независимо от запроса", async () => {
    const category = subcategoryTypeCategory();
    queries.getCategory.mockResolvedValue(category);
    queries.getSubcategories.mockResolvedValue([
      { slug: "gear-pumps", name: "Шестерённые насосы", image: "/sub.svg" } satisfies Subcategory,
    ]);
    queries.getProductsWithoutSubcategory.mockResolvedValue(emptyProductPage());

    const element = await CategoryPage({
      params: Promise.resolve({ slug: "hydraulic-pumps" }),
      // Реальный запрос несёт page=5 — static-режим обязан замораживать
      // страницу 1 (ровно баг, который эта задача закрывает).
      searchParams: searchParamsFor(undefined, "5"),
    });
    render(element);

    // Уникальный маркер клиентских адаптеров: живой aria-live статус,
    // которого нет у серверного CatalogPagination.
    expect(screen.getByRole("status")).toBeTruthy();
    expect(queries.getProducts).not.toHaveBeenCalled();
    expect(queries.getProductsWithoutSubcategory).toHaveBeenCalledWith("hydraulic-pumps", 1);
  });

  it("сохраняет карточки подкатегорий, порядок и ссылку товара, не добавляет поиск", async () => {
    const category = subcategoryTypeCategory();
    queries.getCategory.mockResolvedValue(category);
    queries.getSubcategories.mockResolvedValue([
      { slug: "gear-pumps", name: "Шестерённые насосы", image: "/sub.svg" } satisfies Subcategory,
    ]);
    queries.getProductsWithoutSubcategory.mockResolvedValue(emptyProductPage());

    const element = await CategoryPage({
      params: Promise.resolve({ slug: "hydraulic-pumps" }),
      searchParams: searchParamsFor(),
    });
    render(element);

    expect(screen.queryByRole("textbox")).toBeNull();
    const headings = screen.getAllByText(/Шестерённые насосы|Фильтр гидравлический/);
    expect(headings.map((node) => node.textContent)).toEqual([
      "Шестерённые насосы",
      "Фильтр гидравлический",
    ]);
    expect(screen.getByRole("link", { name: "Фильтр гидравлический" }).getAttribute("href")).toBe(
      "/catalog/category/hydraulic-pumps/filter-1",
    );
  });
});

describe("category.type === \"subcategory\" (смешанная категория): обычный режим не меняется", () => {
  let CategoryPage: Awaited<ReturnType<typeof importPage>>["default"];

  beforeAll(async () => {
    ({ default: CategoryPage } = await importPage(false));
  });

  it("не монтирует ClientMixedCategoryPagination и передаёт реальный page в getProductsWithoutSubcategory", async () => {
    const category = subcategoryTypeCategory();
    queries.getCategory.mockResolvedValue(category);
    queries.getSubcategories.mockResolvedValue([
      { slug: "gear-pumps", name: "Шестерённые насосы", image: "/sub.svg" } satisfies Subcategory,
    ]);
    queries.getProductsWithoutSubcategory.mockResolvedValue(emptyProductPage({ page: 2 }));

    const element = await CategoryPage({
      params: Promise.resolve({ slug: "hydraulic-pumps" }),
      searchParams: searchParamsFor(undefined, "2"),
    });
    render(element);

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(queries.getProductsWithoutSubcategory).toHaveBeenCalledWith("hydraulic-pumps", 2);
  });
});
