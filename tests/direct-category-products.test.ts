import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  rpc: vi.fn(),
  range: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
}));

import { getProductsWithoutSubcategory } from "@/lib/queries/products";

const DIRECT_ROW = {
  slug: "direct-pump",
  name: "Насос без подкатегории",
  category_slug: "pumps",
  subcategory_slug: null,
  short_description: "Описание",
  article: "P-1",
  cover_url: "/pump-thumb.webp",
  cover_fallback_url: "/pump.webp",
  cover_scale: 1,
  compatible_brands: [],
};

describe("getProductsWithoutSubcategory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
    mocks.rpc.mockReturnValue({ range: mocks.range });
  });

  it("фильтрует и считает только товары без подкатегории через общий RPC", async () => {
    mocks.range.mockResolvedValue({ data: [DIRECT_ROW], error: null, count: 1 });

    const result = await getProductsWithoutSubcategory("pumps", 1);

    expect(mocks.rpc).toHaveBeenCalledWith(
      "search_catalog_products",
      {
        search_query: null,
        category_filter: "pumps",
        subcategory_filter: null,
        brand_filter: null,
        vehicle_type_filter: null,
        require_no_subcategory: true,
      },
      { count: "exact" },
    );
    expect(mocks.range).toHaveBeenCalledWith(0, 23);
    expect(result).toEqual({
      items: [
        {
          slug: "direct-pump",
          name: "Насос без подкатегории",
          category: "pumps",
          subcategory: undefined,
          compatibleBrands: [],
          images: [{ url: "/pump-thumb.webp", fallbackUrl: "/pump.webp", scale: 1 }],
          shortDescription: "Описание",
          article: "P-1",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 24,
      totalPages: 1,
    });
  });

  it("возвращает точный total на странице после последнего товара", async () => {
    mocks.range.mockResolvedValue({ data: [], error: null, count: 30 });

    await expect(getProductsWithoutSubcategory("pumps", 3)).resolves.toEqual({
      items: [],
      total: 30,
      page: 3,
      pageSize: 24,
      totalPages: 2,
    });
    expect(mocks.range).toHaveBeenCalledWith(48, 71);
  });

  it("сохраняет total при реальном ответе PostgREST PGRST103 за концом страницы", async () => {
    mocks.range.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST103", message: "Requested range not satisfiable", details: "An offset of 48 was requested", hint: null },
      count: null,
      status: 416,
      statusText: "Range Not Satisfiable",
    }).mockResolvedValueOnce({
      data: [DIRECT_ROW],
      error: null,
      count: 30,
      status: 206,
      statusText: "Partial Content",
    });

    await expect(getProductsWithoutSubcategory("pumps", 3)).resolves.toEqual({
      items: [],
      total: 30,
      page: 3,
      pageSize: 24,
      totalPages: 2,
    });
    expect(mocks.range).toHaveBeenNthCalledWith(1, 48, 71);
    expect(mocks.range).toHaveBeenNthCalledWith(2, 0, 0);
  });

  it("сохраняет total в legacy fallback при PostgREST 416", async () => {
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url.pathname + url.search);
      if (url.pathname.endsWith("/rpc/search_catalog_products")) {
        return new Response(JSON.stringify({ code: "PGRST202", message: "Function not found" }), {
          status: 404, headers: { "content-type": "application/json" },
        });
      }
      if (url.searchParams.get("offset") === "48") {
        return new Response(JSON.stringify({ code: "PGRST103", message: "Range not satisfiable" }), {
          status: 416,
          headers: { "content-type": "application/json", "content-range": "*/30" },
        });
      }
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json", "content-range": "*/30" },
      });
    };
    mocks.createClient.mockResolvedValue(createSupabaseClient(
      "http://127.0.0.1:59999", "sb_publishable_test",
      { global: { fetch: fetchImpl }, auth: { persistSession: false } },
    ));

    await expect(getProductsWithoutSubcategory("pumps", 3)).resolves.toEqual({
      items: [], total: 30, page: 3, pageSize: 24, totalPages: 2,
    });
    expect(requests.some((request) => request.includes("offset=48"))).toBe(true);
    expect(requests.some((request) => request.includes("offset=0"))).toBe(true);
  });

  it.each([
    [0, 1, 0],
    [-4, 1, 0],
    [1.5, 1, 0],
    [Number.MAX_SAFE_INTEGER, 1, 0],
  ])("нормализует некорректную страницу %s так же, как Worker", async (page, expectedPage, from) => {
    mocks.range.mockResolvedValue({ data: [], error: null, count: 0 });

    await expect(getProductsWithoutSubcategory("pumps", page)).resolves.toMatchObject({
      page: expectedPage,
      pageSize: 24,
    });
    expect(mocks.range).toHaveBeenCalledWith(from, from + 23);
  });

  it("сохраняет ограничение размера страницы", async () => {
    mocks.range.mockResolvedValue({ data: [], error: null, count: 0 });

    await expect(getProductsWithoutSubcategory("pumps", 1, 500)).resolves.toMatchObject({ pageSize: 48 });
    expect(mocks.range).toHaveBeenCalledWith(0, 47);
  });
});
