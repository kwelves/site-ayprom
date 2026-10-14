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
      getProductHref({ ...baseProduct, category: "direct" }, {}, new Set(["direct"])),
    ).toBe("/catalog/category/direct/pump-110");
  });

  it("строит прямой путь для товара без подкатегории в смешанной категории", () => {
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

// Один товар с несколькими допустимыми брендами должен получать один и тот же
// основной URL из любого источника данных: Supabase, sitemap, static snapshot и
// API могут отдавать compatibleBrands и category_brands в разном порядке.
describe("getProductHref: стабильный выбор бренда независимо от порядка", () => {
  const permutations = <T>(items: T[]): T[][] =>
    items.length <= 1
      ? [items]
      : items.flatMap((item, index) =>
        permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));

  const brandProduct = (compatibleBrands: string[]): ProductListItem => ({
    ...baseProduct,
    category: "pto",
    compatibleBrands,
  });

  it("даёт одинаковый URL для всех перестановок compatibleBrands и разрешённых брендов", () => {
    const hrefs = new Set<string>();
    for (const compatible of permutations(["shacman", "kamaz", "volvo", "daf"])) {
      for (const allowed of permutations(["shacman", "daf", "kamaz"])) {
        hrefs.add(getProductHref(brandProduct(compatible), { pto: allowed }, new Set()));
      }
    }
    expect([...hrefs]).toEqual(["/catalog/category/pto/brand/daf/pump-110"]);
  });

  it("выбирает наименьший slug в лексикографическом порядке кодовых точек, а не первый встреченный", () => {
    expect(
      getProductHref(brandProduct(["shacman", "kamaz"]), { pto: ["shacman", "kamaz"] }, new Set()),
    ).toBe("/catalog/category/pto/brand/kamaz/pump-110");
    expect(
      getProductHref(brandProduct(["kamaz", "shacman"]), { pto: ["shacman", "kamaz"] }, new Set()),
    ).toBe("/catalog/category/pto/brand/kamaz/pump-110");
  });

  it("не зависит от локали: сравнение по кодовым точкам, а не localeCompare", () => {
    // По кодовым точкам "B-brand" < "a-brand"; localeCompare дал бы обратный порядок.
    expect(
      getProductHref(brandProduct(["a-brand", "B-brand"]), { pto: ["a-brand", "B-brand"] }, new Set()),
    ).toBe("/catalog/category/pto/brand/B-brand/pump-110");
  });

  it("игнорирует дубликаты в обоих массивах", () => {
    expect(
      getProductHref(
        brandProduct(["shacman", "shacman", "kamaz", "kamaz"]),
        { pto: ["kamaz", "shacman", "shacman"] },
        new Set(),
      ),
    ).toBe("/catalog/category/pto/brand/kamaz/pump-110");
  });

  it("не использует бренды вне пересечения, даже если они лексикографически меньше", () => {
    expect(
      getProductHref(brandProduct(["aaa", "kamaz"]), { pto: ["kamaz", "bbb"] }, new Set()),
    ).toBe("/catalog/category/pto/brand/kamaz/pump-110");
  });

  it("сохраняет приоритет подкатегории над брендом при любом порядке брендов", () => {
    for (const compatible of permutations(["shacman", "kamaz"])) {
      expect(
        getProductHref({ ...brandProduct(compatible), subcategory: "gear" }, { pto: ["kamaz", "shacman"] }, new Set(["pto"])),
      ).toBe("/catalog/category/pto/subcategory/gear/pump-110");
    }
  });

  it("при пустом пересечении переходит к прямой категории или /catalog", () => {
    expect(
      getProductHref(brandProduct(["volvo", "man"]), { pto: ["kamaz", "shacman"] }, new Set(["pto"])),
    ).toBe("/catalog/category/pto/pump-110");
    expect(
      getProductHref(brandProduct(["volvo", "man"]), { pto: ["kamaz", "shacman"] }, new Set()),
    ).toBe("/catalog");
  });

  it("обрабатывает пустые пограничные данные без исключений", () => {
    expect(getProductHref(brandProduct([]), { pto: ["kamaz"] }, new Set())).toBe("/catalog");
    expect(getProductHref(brandProduct(["kamaz"]), { pto: [] }, new Set())).toBe("/catalog");
    expect(getProductHref(brandProduct(["kamaz"]), {}, new Set())).toBe("/catalog");
    expect(getProductHref(brandProduct([]), {}, new Set(["pto"]))).toBe("/catalog/category/pto/pump-110");
  });

  it("не мутирует входные массивы и объекты", () => {
    const compatible = Object.freeze(["shacman", "kamaz", "daf"]) as unknown as string[];
    const allowed = Object.freeze(["daf", "shacman", "kamaz"]) as unknown as string[];
    const product = Object.freeze(brandProduct(compatible)) as ProductListItem;
    const lookup = Object.freeze({ pto: allowed }) as Record<string, string[]>;
    const direct = new Set(["pto"]);

    expect(getProductHref(product, lookup, direct)).toBe("/catalog/category/pto/brand/daf/pump-110");
    expect(product.compatibleBrands).toEqual(["shacman", "kamaz", "daf"]);
    expect(lookup.pto).toEqual(["daf", "shacman", "kamaz"]);
    expect([...direct]).toEqual(["pto"]);
  });
});
