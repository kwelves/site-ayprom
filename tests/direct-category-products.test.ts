import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { getProductsWithoutSubcategory } from "@/lib/queries/products";

describe("getProductsWithoutSubcategory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("фильтрует и считает только товары без подкатегории", async () => {
    const range = vi.fn().mockResolvedValue({
      data: [
        {
          slug: "direct-pump",
          name: "Насос без подкатегории",
          category_slug: "pumps",
          short_description: "Описание",
          article: "P-1",
          subcategories: null,
          product_images: [{ url: "/pump.webp", order: 0, scale: 1 }],
          product_brands: [],
        },
      ],
      error: null,
      count: 1,
    });
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      range,
    };
    for (const method of [query.select, query.eq, query.is, query.order, query.limit]) {
      method.mockReturnValue(query);
    }
    const from = vi.fn().mockReturnValue(query);
    mocks.createClient.mockResolvedValue({ from });

    const result = await getProductsWithoutSubcategory("pumps", 1);

    expect(from).toHaveBeenCalledWith("products");
    expect(query.eq).toHaveBeenCalledWith("category_slug", "pumps");
    expect(query.is).toHaveBeenCalledWith("subcategory_id", null);
    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({ slug: "direct-pump", category: "pumps", subcategory: undefined }),
    ]);
  });
});
