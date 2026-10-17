import { expect, it, vi } from "vitest";

vi.mock("@/lib/queries/categories", () => ({
  getCategories: async () => [
    { slug: "fittings", name: "Фитинги", type: null, description: "", icon: "", image: "" },
    { slug: "pto", name: "КОМ", type: "brand", description: "", icon: "", image: "" },
  ],
  getDirectProductCategorySlugs: async () => new Set(["fittings"]),
}));
vi.mock("@/lib/queries/subcategories", () => ({ getAllSubcategories: async () => [] }));
vi.mock("@/lib/queries/brands", () => ({ getBrands: async () => [{ slug: "kamaz", name: "КАМАЗ", country: "", logo: "" }] }));
vi.mock("@/lib/queries/vehicle-types", () => ({ getVehicleTypes: async () => [{ slug: "truck", name: "Грузовик" }] }));
vi.mock("@/lib/queries/category-brands", () => ({ getCategoryBrandSlugs: async () => ({ pto: ["kamaz"] }) }));
vi.mock("@/lib/queries/products", () => ({ getSitemapProducts: async () => [
  {
    slug: "seal", name: "Уплотнение", category: "fittings", compatibleBrands: [],
    images: [{ url: "/images/seal.jpg" }], shortDescription: "Уплотнение",
    updatedAt: "2026-09-22T10:00:00Z",
  },
  {
    slug: "unrouted", name: "Без бренда", category: "pto", compatibleBrands: [],
    images: [], shortDescription: "Без бренда", updatedAt: "2026-09-22T11:00:00Z",
  },
] }));
vi.mock("@/lib/site-url", () => ({ getSiteUrl: () => "https://www.ayprom-gidravlika.kg" }));

import sitemap from "@/app/sitemap";

it("keeps the legacy sitemap URL order and metadata while omitting unresolved products", async () => {
  expect(await sitemap()).toEqual([
    { url: "https://www.ayprom-gidravlika.kg", changeFrequency: "weekly", priority: 1 },
    { url: "https://www.ayprom-gidravlika.kg/catalog", changeFrequency: "daily", priority: 0.9 },
    { url: "https://www.ayprom-gidravlika.kg/about", changeFrequency: "monthly", priority: 0.5 },
    { url: "https://www.ayprom-gidravlika.kg/contacts", changeFrequency: "monthly", priority: 0.6 },
    { url: "https://www.ayprom-gidravlika.kg/nsh-nasos", changeFrequency: "monthly", priority: 0.8 },
    { url: "https://www.ayprom-gidravlika.kg/nsh-nasos/na-samosval", changeFrequency: "monthly", priority: 0.7 },
    { url: "https://www.ayprom-gidravlika.kg/nsh-nasos/na-tonar", changeFrequency: "monthly", priority: 0.7 },
    { url: "https://www.ayprom-gidravlika.kg/nsh-nasos/na-manipulyator", changeFrequency: "monthly", priority: 0.7 },
    { url: "https://www.ayprom-gidravlika.kg/catalog/category/fittings", changeFrequency: "weekly", priority: 0.8 },
    { url: "https://www.ayprom-gidravlika.kg/catalog/category/pto", changeFrequency: "weekly", priority: 0.8 },
    { url: "https://www.ayprom-gidravlika.kg/catalog/brand/kamaz", changeFrequency: "weekly", priority: 0.7 },
    { url: "https://www.ayprom-gidravlika.kg/catalog/vehicle-type/truck", changeFrequency: "weekly", priority: 0.7 },
    { url: "https://www.ayprom-gidravlika.kg/catalog/category/pto/brand/kamaz", changeFrequency: "weekly", priority: 0.7 },
    {
      url: "https://www.ayprom-gidravlika.kg/catalog/category/fittings/seal",
      lastModified: "2026-09-22T10:00:00Z", changeFrequency: "weekly", priority: 0.8,
      images: ["https://www.ayprom-gidravlika.kg/images/seal.jpg"],
    },
  ]);
});
