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
      getProductHref({ ...baseProduct, subcategory: "gear" }, {}, new Set()),
    ).toBe("/catalog/category/pumps/subcategory/gear/pump-110");
  });

  it("выбирает только допустимый для категории бренд", () => {
    expect(
      getProductHref(
        { ...baseProduct, category: "pto", compatibleBrands: ["volvo", "daf"] },
        { pto: ["daf"] },
        new Set(),
      ),
    ).toBe("/catalog/category/pto/brand/daf/pump-110");
  });

  it("строит путь товара напрямую под «прямой» категорией", () => {
    expect(
      getProductHref(baseProduct, {}, new Set(["pumps"])),
    ).toBe("/catalog/category/pumps/pump-110");
  });

  it("не путает «прямую» категорию с брендовой, если найден подходящий бренд", () => {
    expect(
      getProductHref(
        { ...baseProduct, category: "pto", compatibleBrands: ["daf"] },
        { pto: ["daf"] },
        new Set(["pto"]),
      ),
    ).toBe("/catalog/category/pto/brand/daf/pump-110");
  });

  it("возвращает реальный fallback для неполных данных", () => {
    expect(getProductHref(baseProduct, {}, new Set())).toBe("/catalog");
  });
});
