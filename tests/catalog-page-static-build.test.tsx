// @vitest-environment jsdom
//
// Guards src/app/(site)/catalog/page.tsx's STATIC_BUILD branch: /catalog is
// a cross-category listing (no category/subcategory/brand route segment),
// so it needs ClientCatalogSearch wired with `productRouting`, not a plain
// `basePath` — every other already-wired page family links every product
// from one shared base path, but /catalog mixes products from any category.
//
// STATIC_BUILD is a module-level constant read at import time
// (`process.env.AYPROM_STATIC_BUILD === "1"`), so each *describe* block
// (one static, one normal) resets the module registry and re-imports the
// page once, in `beforeAll`, with the env var set beforehand — not once per
// `it`. `vi.resetModules()` plus a dynamic `import()` re-transpiles and
// re-evaluates the page's whole dependency tree; every test in a describe
// block wants the exact same STATIC_BUILD value, so importing it fresh per
// test bought nothing but CPU time, and under worker contention
// (`--maxWorkers=2` with other heavy test files running concurrently) that
// extra time was enough to occasionally push a test past its 5s timeout.

import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const queries = vi.hoisted(() => ({
  getProducts: vi.fn(),
  getCategoryBrandSlugs: vi.fn(),
  getDirectProductCategorySlugs: vi.fn(),
}));

vi.mock("@/lib/queries/products", () => ({
  getProducts: queries.getProducts,
  parseCatalogPage: (value?: string) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  },
}));
vi.mock("@/lib/queries/category-brands", () => ({
  getCategoryBrandSlugs: queries.getCategoryBrandSlugs,
}));
vi.mock("@/lib/queries/categories", () => ({
  getDirectProductCategorySlugs: queries.getDirectProductCategorySlugs,
}));

function productPage(overrides: Partial<ProductPage> = {}): ProductPage {
  return {
    items: [
      {
        slug: "gear-pump",
        name: "Шестерённый насос",
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
  return import("@/app/(site)/catalog/page");
}

function searchParamsFor(q?: string, page?: string) {
  return Promise.resolve({ q, page });
}

beforeEach(() => {
  queries.getProducts.mockReset();
  queries.getCategoryBrandSlugs.mockReset().mockResolvedValue({});
  queries.getDirectProductCategorySlugs.mockReset().mockResolvedValue(new Set<string>());
});

afterEach(() => {
  cleanup();
});

describe("/catalog: static-build режим", () => {
  let CatalogPage: Awaited<ReturnType<typeof importPage>>["default"];

  beforeAll(async () => {
    ({ default: CatalogPage } = await importPage(true));
  });

  afterAll(() => {
    delete process.env.AYPROM_STATIC_BUILD;
  });

  it("монтирует ClientCatalogSearch, замораживая страницу 1 без q/page от запроса", async () => {
    queries.getProducts.mockResolvedValue(productPage());

    const element = await CatalogPage({ searchParams: searchParamsFor("посторонний-запрос", "5") });
    render(element);

    expect(screen.getByRole("status")).toBeTruthy();
    expect(queries.getProducts).toHaveBeenCalledWith({});
  });

  it("ссылка товара строится через productRouting (getProductHref), не через фиксированный basePath", async () => {
    queries.getProducts.mockResolvedValue(productPage());
    queries.getCategoryBrandSlugs.mockResolvedValue({ pto: ["man"] });
    queries.getDirectProductCategorySlugs.mockResolvedValue(new Set(["filters"]));

    const element = await CatalogPage({ searchParams: searchParamsFor() });
    render(element);

    const link = screen.getByRole("link", { name: "Шестерённый насос" });
    expect(link.getAttribute("href")).toBe("/catalog/category/hydraulic-pumps/subcategory/gear-pumps/gear-pump");
  });

  it("multi-brand товар без подкатегории ведёт на страницу выбранного бренда", async () => {
    queries.getProducts.mockResolvedValue(
      productPage({
        items: [
          {
            slug: "shaft",
            name: "Вал отбора мощности",
            category: "pto",
            compatibleBrands: ["man", "kamaz"],
            images: [],
            shortDescription: "Описание",
          },
        ],
      }),
    );
    queries.getCategoryBrandSlugs.mockResolvedValue({ pto: ["kamaz", "man"] });
    queries.getDirectProductCategorySlugs.mockResolvedValue(new Set<string>());

    const element = await CatalogPage({ searchParams: searchParamsFor() });
    render(element);

    const link = screen.getByRole("link", { name: "Вал отбора мощности" });
    // The shared routing contract chooses the smallest valid brand slug,
    // independently of compatibleBrands order (man comes first above).
    expect(link.getAttribute("href")).toBe("/catalog/category/pto/brand/kamaz/shaft");
  });
});

describe("/catalog: обычный режим не меняется", () => {
  let CatalogPage: Awaited<ReturnType<typeof importPage>>["default"];

  beforeAll(async () => {
    ({ default: CatalogPage } = await importPage(false));
  });

  it("не монтирует ClientCatalogSearch и передаёт реальные q/page в getProducts", async () => {
    queries.getProducts.mockResolvedValue(productPage());

    const element = await CatalogPage({ searchParams: searchParamsFor("насос", "2") });
    render(element);

    expect(screen.queryByRole("status")).toBeNull();
    expect(queries.getProducts).toHaveBeenCalledWith({ query: "насос", page: 2 });
  });

  it("ссылка товара строится как раньше, через getProductHref на сервере", async () => {
    queries.getProducts.mockResolvedValue(productPage());
    queries.getCategoryBrandSlugs.mockResolvedValue({});
    queries.getDirectProductCategorySlugs.mockResolvedValue(new Set<string>());

    const element = await CatalogPage({ searchParams: searchParamsFor() });
    render(element);

    const link = screen.getByRole("link", { name: "Шестерённый насос" });
    expect(link.getAttribute("href")).toBe("/catalog/category/hydraulic-pumps/subcategory/gear-pumps/gear-pump");
  });
});
