import { describe, expect, it } from "vitest";
import { buildMixedCategoryGridItems } from "@/lib/mixed-category-grid";
import type { ProductListItem, Subcategory } from "@/types/catalog";

describe("buildMixedCategoryGridItems", () => {
  it("ставит товар без подкатегории четвёртой карточкой после трёх подкатегорий", () => {
    const subcategories: Subcategory[] = [
      { slug: "one", name: "Первая", image: "/one.webp" },
      { slug: "two", name: "Вторая", image: "/two.webp" },
      { slug: "three", name: "Третья", image: "/three.webp" },
    ];
    const products: ProductListItem[] = [
      {
        slug: "direct-pump",
        name: "Товар",
        category: "pumps",
        compatibleBrands: [],
        images: [],
        shortDescription: "",
      },
    ];

    expect(buildMixedCategoryGridItems(subcategories, products).map(({ kind, item }) => `${kind}:${item.slug}`)).toEqual([
      "subcategory:one",
      "subcategory:two",
      "subcategory:three",
      "product:direct-pump",
    ]);
  });
});
