import { describe, expect, it, vi } from "vitest";
import { createRouteManifest, derivePublicRoutes, serializeRouteManifest } from "@/cloudflare/static-build";
import type { CatalogRouteSource } from "@/cloudflare/static-build/derive-routes";

// Regression/parity: для товара с несколькими допустимыми брендами основной URL,
// alias-redirect и sitemap не должны зависеть от порядка compatibleBrands или
// category_brands в источнике данных. Мутируется только локальная копия фикстуры.

const siteUrl = "https://www.ayprom-gidravlika.kg";

// Порядок намеренно «неудобный»: shacman идёт первым и в товаре, и в category_brands,
// но лексикографически меньший slug — kamaz.
const adverseOrder = { compatibleBrands: ["shacman", "kamaz"], categoryBrands: ["shacman", "kamaz"] };
const naturalOrder = { compatibleBrands: ["kamaz", "shacman"], categoryBrands: ["kamaz", "shacman"] };

function source(order: { compatibleBrands: string[]; categoryBrands: string[] }): CatalogRouteSource {
  return {
    snapshotId: "fixture",
    categories: [{ slug: "pto", type: "brand" }],
    subcategories: [],
    brands: [{ slug: "kamaz" }, { slug: "shacman" }],
    vehicleTypes: [],
    categoryBrands: { pto: [...order.categoryBrands] },
    directProductCategorySlugs: [],
    products: [{
      slug: "shaft",
      name: "Вал",
      category: "pto",
      compatibleBrands: [...order.compatibleBrands],
      images: [],
      shortDescription: "Вал",
      updatedAt: "2026-09-22T12:00:00Z",
    }],
  };
}

describe("multi-brand product: derive-routes parity независимо от порядка брендов", () => {
  it("даёт один и тот же canonical, alias-redirect и sitemap-путь при любом порядке", () => {
    const natural = derivePublicRoutes(source(naturalOrder), siteUrl);
    const adverse = derivePublicRoutes(source(adverseOrder), siteUrl);

    const canonical = "/catalog/category/pto/brand/kamaz/shaft";
    for (const derived of [natural, adverse]) {
      expect(derived.sitemapEntries.filter((entry) => entry.path.endsWith("/shaft")).map((entry) => entry.path))
        .toEqual([canonical]);
      expect(derived.manifestEntries).toContainEqual(expect.objectContaining({
        class: "redirect", family: "product-alias", path: "/product/shaft", redirectTo: canonical,
      }));
    }
  });

  it("сохраняет все реально обслуживаемые brand URL товара и не удаляет варианты", () => {
    const { manifestEntries } = derivePublicRoutes(source(adverseOrder), siteUrl);
    const productPaths = manifestEntries
      .filter((entry) => entry.family === "product" && entry.class === "static")
      .map((entry) => entry.path)
      .sort();
    expect(productPaths).toEqual([
      "/catalog/category/pto/brand/kamaz/shaft",
      "/catalog/category/pto/brand/shacman/shaft",
    ]);
  });

  it("сериализует байт-идентичный manifest для обоих порядков", () => {
    const natural = createRouteManifest("fixture", derivePublicRoutes(source(naturalOrder), siteUrl).manifestEntries);
    const adverse = createRouteManifest("fixture", derivePublicRoutes(source(adverseOrder), siteUrl).manifestEntries);
    expect(natural.ok).toBe(true);
    expect(adverse.ok).toBe(true);
    if (!natural.ok || !adverse.ok) return;
    expect(serializeRouteManifest(adverse.value)).toBe(serializeRouteManifest(natural.value));
  });
});

// Sitemap-адаптер Next получает данные из Supabase-запросов; моки возвращают
// «неудобный» порядок, чтобы доказать, что адаптер наследует стабильный выбор.
vi.mock("@/lib/queries/categories", () => ({
  getCategories: async () => [{ slug: "pto", name: "КОМ", type: "brand", description: "", icon: "", image: "" }],
  getDirectProductCategorySlugs: async () => new Set<string>(),
}));
vi.mock("@/lib/queries/subcategories", () => ({ getAllSubcategories: async () => [] }));
vi.mock("@/lib/queries/brands", () => ({ getBrands: async () => [
  { slug: "shacman", name: "SHACMAN", country: "", logo: "" },
  { slug: "kamaz", name: "КАМАЗ", country: "", logo: "" },
] }));
vi.mock("@/lib/queries/vehicle-types", () => ({ getVehicleTypes: async () => [] }));
vi.mock("@/lib/queries/category-brands", () => ({ getCategoryBrandSlugs: async () => ({ pto: ["shacman", "kamaz"] }) }));
vi.mock("@/lib/queries/products", () => ({ getSitemapProducts: async () => [{
  slug: "shaft", name: "Вал", category: "pto", compatibleBrands: ["shacman", "kamaz"],
  images: [], shortDescription: "Вал", updatedAt: "2026-09-22T12:00:00Z",
}] }));
vi.mock("@/lib/site-url", () => ({ getSiteUrl: () => siteUrl }));

import sitemap from "@/app/sitemap";

describe("multi-brand product: legacy sitemap adapter", () => {
  it("публикует один стабильный URL товара даже при обратном порядке брендов в данных", async () => {
    const productUrls = (await sitemap())
      .map((entry) => entry.url)
      .filter((url) => url.endsWith("/shaft"));
    expect(productUrls).toEqual([`${siteUrl}/catalog/category/pto/brand/kamaz/shaft`]);
  });
});
