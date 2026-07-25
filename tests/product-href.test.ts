import { describe, expect, it } from "vitest";
import { getProductHref } from "@/lib/product-href";
import type { ProductListItem } from "@/types/catalog";

const baseProduct: ProductListItem = {
  slug: "pump-110",
  name: "Насос",
  category: "pumps",
  compatibleBrands: [],
  images: [],
  shortDescription: "Описание",
};

describe("getProductHref", () => {
  it("строит путь товара под подкатегорией", () => {
    expect(
      getProductHref({ ...baseProduct, subcategory: "gear" }, {}),
    ).toBe("/catalog/category/pumps/subcategory/gear/pump-110");
  });

  it("выбирает только допустимый для категории бренд", () => {
    expect(
      getProductHref(
        { ...baseProduct, category: "pto", compatibleBrands: ["volvo", "daf"] },
        { pto: ["daf"] },
      ),
    ).toBe("/catalog/category/pto/brand/daf/pump-110");
  });

  it("возвращает реальный fallback для неполных данных", () => {
    expect(getProductHref(baseProduct, {})).toBe("/catalog");
  });
});
