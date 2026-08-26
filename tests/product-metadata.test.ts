import { describe, expect, it } from "vitest";
import { buildProductMetadata, MISSING_PRODUCT_METADATA } from "@/lib/product-metadata";
import type { Product } from "@/types/catalog";

function product(overrides: Partial<Product> = {}): Product {
  return {
    slug: "shesterenchatyy-nasos-boherta-nsh-63",
    name: "Шестеренчатый насос BOHERTA НШ 63",
    category: "gidravlicheskie-nasosy",
    compatibleBrands: [],
    vehicleTypes: [],
    images: [],
    shortDescription: "",
    ...overrides,
  } as Product;
}

const CANONICAL = "/catalog/category/gidravlicheskie-nasosy/shesterenchatyy-nasos-boherta-nsh-63";

describe("buildProductMetadata", () => {
  it("отдаёт приоритет SEO-полям из админки", () => {
    const meta = buildProductMetadata(
      product({
        metaTitle: "Насос НШ 63 купить в Бишкеке",
        metaDescription: "Шестерённый насос НШ 63 в наличии.",
        description: "Обычное описание",
        shortDescription: "Краткое описание",
      }),
      CANONICAL,
    );

    expect(meta.title).toBe("Насос НШ 63 купить в Бишкеке");
    expect(meta.description).toBe("Шестерённый насос НШ 63 в наличии.");
  });

  it("использует описание товара, когда SEO-поля пустые", () => {
    const meta = buildProductMetadata(
      product({ description: "Обычное описание", shortDescription: "Краткое описание" }),
      CANONICAL,
    );

    expect(meta.description).toBe("Обычное описание");
  });

  it("подставляет осмысленное описание товару без единого текста", () => {
    const meta = buildProductMetadata(product({ article: "НШ-63-3" }), CANONICAL);

    expect(meta.title).toBe("Шестеренчатый насос BOHERTA НШ 63");
    expect(meta.description).toContain("Шестеренчатый насос BOHERTA НШ 63");
    expect(meta.description).toContain("Бишкеке");
    expect(meta.description).toContain("НШ-63-3");
  });

  it("не превышает лимит длины сниппета", () => {
    const meta = buildProductMetadata(product({ description: "Слово ".repeat(120) }), CANONICAL);

    expect(meta.description!.length).toBeLessThanOrEqual(161);
    expect(meta.description!.endsWith("…")).toBe(true);
  });

  it("проставляет canonical и OpenGraph-картинку", () => {
    const meta = buildProductMetadata(
      product({ images: [{ url: "https://example.com/nsh.png" }] }),
      CANONICAL,
    );

    expect(meta.alternates?.canonical).toBe(CANONICAL);
    expect(meta.openGraph).toMatchObject({ url: CANONICAL });
  });

  it("закрывает от индексации страницу ненайденного товара", () => {
    expect(MISSING_PRODUCT_METADATA.robots).toMatchObject({ index: false });
  });
});
