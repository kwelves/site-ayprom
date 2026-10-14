// @vitest-environment jsdom
//
// Guards src/app/(site)/catalog/vehicle-type/[slug]/page.tsx's STATIC_BUILD
// branch: like /catalog, this is a cross-category listing, so it needs
// ClientCatalogSearch wired with `productRouting`, plus the route's own
// `vehicleTypeSlug` filter carried through to the public search API.
//
// STATIC_BUILD is a module-level constant read at import time, so each
// *describe* block (one static, one normal) resets the module registry and
// re-imports the page once, in `beforeAll` — not once per `it`. Every test
// in a describe block wants the same STATIC_BUILD value, so re-importing
// per test only cost CPU time; under worker contention that extra time
// could push a test past its 5s timeout (see the two fixes below for what
// happened next when that occurred).
//
// Two real state leaks, not just slowness, made a timeout here contagious:
//
// 1. `window.location`/history persists across every `it` within one test
//    file (jsdom is created once per file, not per test). The pagination
//    click test below calls `history.pushState` to `?page=2` and nothing
//    reset it afterwards, so every later test in this file mounted with a
//    stale `?page=2` still in the URL — silently triggering an unmocked
//    fetch on mount in tests that never expected one.
// 2. That same test stubbed `global.fetch` and only called
//    `vi.unstubAllGlobals()` on its success path (after `await waitFor`).
//    If that assertion ever failed or timed out, the stub leaked into every
//    later test in the file instead of being restored.
// Both are fixed by resetting the URL and unstubbing globals in a single
// `beforeEach`/`afterEach` pair that runs unconditionally, regardless of
// how the previous test ended.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductPage } from "@/lib/catalog-search-contract";

const BASE_PATH = "/catalog/vehicle-type/samosval";

function setLocation(path: string) {
  window.history.replaceState(null, "", path);
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  notFound: vi.fn(() => {
    throw new Error("unexpected notFound() call in a found-vehicle-type test");
  }),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

vi.mock("@/lib/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

const queries = vi.hoisted(() => ({
  getVehicleType: vi.fn(),
  getProducts: vi.fn(),
  getCategoryBrandSlugs: vi.fn(),
  getDirectProductCategorySlugs: vi.fn(),
}));

vi.mock("@/lib/queries/vehicle-types", () => ({
  getVehicleType: queries.getVehicleType,
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
  return import("@/app/(site)/catalog/vehicle-type/[slug]/page");
}

function searchParamsFor(q?: string, page?: string) {
  return Promise.resolve({ q, page });
}

beforeEach(() => {
  queries.getVehicleType.mockReset();
  queries.getProducts.mockReset();
  queries.getCategoryBrandSlugs.mockReset().mockResolvedValue({});
  queries.getDirectProductCategorySlugs.mockReset().mockResolvedValue(new Set<string>());
  // Reset before every test, unconditionally — a previous test's pagination
  // click (or an interrupted one) must never leak its URL into this test.
  setLocation(BASE_PATH);
});

afterEach(() => {
  cleanup();
  // Unconditional, regardless of whether *this* test stubbed fetch — the
  // pagination-click test below only needs the stub for its own duration,
  // and this guarantees it never survives past the test that set it up,
  // even if that test failed or timed out before reaching its own cleanup.
  vi.unstubAllGlobals();
});

describe("/catalog/vehicle-type/[slug]: static-build режим", () => {
  let VehicleTypePage: Awaited<ReturnType<typeof importPage>>["default"];

  beforeAll(async () => {
    ({ default: VehicleTypePage } = await importPage(true));
  });

  afterAll(() => {
    delete process.env.AYPROM_STATIC_BUILD;
  });

  it("монтирует ClientCatalogSearch, замораживая страницу 1 без q/page от запроса", async () => {
    queries.getVehicleType.mockResolvedValue({ slug: "samosval", name: "Самосвал" });
    queries.getProducts.mockResolvedValue(productPage());

    const element = await VehicleTypePage({
      params: Promise.resolve({ slug: "samosval" }),
      searchParams: searchParamsFor("посторонний-запрос", "5"),
    });
    render(element);

    expect(screen.getByRole("status")).toBeTruthy();
    expect(queries.getProducts).toHaveBeenCalledWith({ vehicleTypeSlug: "samosval" });
  });

  it("клик «Вперёд» запрашивает vehicleType в публичном API", async () => {
    queries.getVehicleType.mockResolvedValue({ slug: "samosval", name: "Самосвал" });
    queries.getProducts.mockResolvedValue(productPage({ total: 30, totalPages: 2 }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(productPage({ items: [], total: 30, page: 2, totalPages: 2 })), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const element = await VehicleTypePage({
      params: Promise.resolve({ slug: "samosval" }),
      searchParams: searchParamsFor(),
    });
    render(element);

    fireEvent.click(screen.getByRole("link", { name: /вперёд/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/catalog/search?vehicleType=samosval&page=2",
        expect.anything(),
      ),
    );
  });

  it("ссылка товара строится через productRouting (getProductHref), не под этим маршрутом", async () => {
    queries.getVehicleType.mockResolvedValue({ slug: "samosval", name: "Самосвал" });
    queries.getProducts.mockResolvedValue(productPage());
    queries.getCategoryBrandSlugs.mockResolvedValue({ pto: ["man"] });
    queries.getDirectProductCategorySlugs.mockResolvedValue(new Set(["filters"]));

    const element = await VehicleTypePage({
      params: Promise.resolve({ slug: "samosval" }),
      searchParams: searchParamsFor(),
    });
    render(element);

    const link = screen.getByRole("link", { name: "Шестерённый насос" });
    expect(link.getAttribute("href")).toBe("/catalog/category/hydraulic-pumps/subcategory/gear-pumps/gear-pump");
  });

  it("multi-brand товар без подкатегории ведёт на страницу выбранного бренда", async () => {
    queries.getVehicleType.mockResolvedValue({ slug: "samosval", name: "Самосвал" });
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

    const element = await VehicleTypePage({
      params: Promise.resolve({ slug: "samosval" }),
      searchParams: searchParamsFor(),
    });
    render(element);

    const link = screen.getByRole("link", { name: "Вал отбора мощности" });
    // The shared routing contract chooses the smallest valid brand slug,
    // independently of compatibleBrands order (man comes first above).
    expect(link.getAttribute("href")).toBe("/catalog/category/pto/brand/kamaz/shaft");
  });

  it("отсутствующий тип техники по-прежнему приводит к notFound()", async () => {
    queries.getVehicleType.mockResolvedValue(null);
    queries.getProducts.mockResolvedValue(productPage({ items: [], total: 0 }));

    await expect(
      VehicleTypePage({
        params: Promise.resolve({ slug: "unknown-type" }),
        searchParams: searchParamsFor(),
      }),
    ).rejects.toThrow("unexpected notFound() call in a found-vehicle-type test");
  });
});

describe("/catalog/vehicle-type/[slug]: обычный режим не меняется", () => {
  let VehicleTypePage: Awaited<ReturnType<typeof importPage>>["default"];

  beforeAll(async () => {
    ({ default: VehicleTypePage } = await importPage(false));
  });

  it("не монтирует ClientCatalogSearch и передаёт реальные q/page в getProducts", async () => {
    queries.getVehicleType.mockResolvedValue({ slug: "samosval", name: "Самосвал" });
    queries.getProducts.mockResolvedValue(productPage());

    const element = await VehicleTypePage({
      params: Promise.resolve({ slug: "samosval" }),
      searchParams: searchParamsFor("насос", "2"),
    });
    render(element);

    expect(screen.queryByRole("status")).toBeNull();
    expect(queries.getProducts).toHaveBeenCalledWith({ vehicleTypeSlug: "samosval", query: "насос", page: 2 });
  });
});
