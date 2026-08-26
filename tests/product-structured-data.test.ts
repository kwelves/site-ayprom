import { afterEach, describe, expect, it } from "vitest";
import { buildProductStructuredData } from "@/lib/product-structured-data";
import type { Product } from "@/types/catalog";

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (originalSiteUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  }
});

function product(overrides: Partial<Product> = {}): Product {
  return {
    slug: "adapter-1",
    name: "Адаптер 1",
    category: "komplektuyuschie",
    compatibleBrands: [],
    vehicleTypes: [],
    images: [],
    shortDescription: "",
    ...overrides,
  } as Product;
}

describe("product structured data", () => {
  it("публикует валидные хлебные крошки без недействительного Product", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.ayprom-gidravlika.kg/";

    const data = buildProductStructuredData(
      product({
        article: "ADAPTER-1",
        description: "Описание без публичной цены",
        images: [{ url: "/images/adapter-1.jpg" }],
      }),
      "/catalog/category/komplektuyuschie/subcategory/adaptery/adapter-1",
    );

    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Главная",
          item: "https://www.ayprom-gidravlika.kg",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Каталог",
          item: "https://www.ayprom-gidravlika.kg/catalog",
        },
        {
          "@type": "ListItem",
          position: 3,
          name: "Адаптер 1",
          item: "https://www.ayprom-gidravlika.kg/catalog/category/komplektuyuschie/subcategory/adaptery/adapter-1",
        },
      ],
    });
    expect(JSON.stringify(data)).not.toContain('"@type":"Product"');
  });
});
