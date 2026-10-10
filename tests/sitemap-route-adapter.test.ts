import { expect, it, vi } from "vitest";

vi.mock("@/lib/queries/categories", () => ({
  getCategories: async () => [],
  getDirectProductCategorySlugs: async () => new Set<string>(),
}));
vi.mock("@/lib/queries/subcategories", () => ({ getAllSubcategories: async () => [] }));
vi.mock("@/lib/queries/brands", () => ({ getBrands: async () => [] }));
vi.mock("@/lib/queries/vehicle-types", () => ({ getVehicleTypes: async () => [] }));
vi.mock("@/lib/queries/category-brands", () => ({ getCategoryBrandSlugs: async () => ({}) }));
vi.mock("@/lib/queries/products", () => ({ getSitemapProducts: async () => [] }));
vi.mock("@/lib/site-url", () => ({ getSiteUrl: () => "https://www.ayprom-gidravlika.kg" }));
vi.mock("@/cloudflare/static-build/derive-routes", () => ({
  derivePublicRoutes: () => ({
    manifestEntries: [],
    blockers: [],
    sitemapEntries: [{ path: "/catalog/category/pumps", changeFrequency: "weekly", priority: 0.8 }],
  }),
}));

import sitemap from "@/app/sitemap";

it("uses the shared route projection as the legacy Next sitemap adapter", async () => {
  expect(await sitemap()).toEqual([{
    url: "https://www.ayprom-gidravlika.kg/catalog/category/pumps",
    changeFrequency: "weekly",
    priority: 0.8,
  }]);
});
