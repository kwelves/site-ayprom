import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeCatalogReaderIfEnabled } from "@/lib/catalog-publication-reader";
import type { CatalogPublicationReader } from "@/lib/catalog-publication-reader";
import { createClient } from "@/lib/supabase/server";
import { getCategories, getBrandCategories, getDirectProductCategorySlugs } from "@/lib/queries/categories";
import { getSubcategories, getSubcategory, getBrandSubcategories, getAllSubcategories } from "@/lib/queries/subcategories";
import { getBrands } from "@/lib/queries/brands";
import { getCategoryBrands, getCategoryBrandSlugs } from "@/lib/queries/category-brands";
import { getVehicleTypes } from "@/lib/queries/vehicle-types";
import { getVehicleShowcaseData } from "@/lib/queries/vehicle-hotspots";
import { getProduct, getProducts, getSitemapProducts } from "@/lib/queries/products";

vi.mock("@/lib/catalog-publication-reader", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/catalog-publication-reader")>(),
  activeCatalogReaderIfEnabled: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const rows: Record<string, Record<string, unknown>[]> = {
  category: [
    { slug: "flat", name: "Flat", description: "", icon: "pto", image: "", intro: null, type: null, order: 2 },
    { slug: "mixed", name: "Mixed", description: "", icon: "pto", image: "", intro: null, type: "subcategory", order: 1 },
  ],
  subcategory: [{ category_slug: "mixed", slug: "pump", name: "Pump", image: "", intro: null, order: 1 }],
  brand: [{ slug: "kamaz", name: "Kamaz", country: "", logo: "", logo_scale: null, order: 1 }],
  category_brand: [{ category_slug: "flat", brand_slug: "kamaz", logo_scale_override: 1.2, order: 1 }],
  vehicle_type: [{ slug: "truck", name: "Truck", order: 1 }],
  vehicle_hotspot: [{ id: "h1", vehicle_type_slug: "truck", hotspot_number: 1, label: "H", x_pct: "20", y_pct: "30", products: null }],
  product: [{ slug: "shaft", name: "Shaft", category_slug: "flat", short_description: "short", description: "full", article: "A1", meta_title: "SEO", meta_description: "desc", order: 1, updated_at: "2026-01-01T00:00:00Z", subcategories: null, product_images: [{ url: "https://media.example/shaft.jpg", order: 1, scale: null, thumbnail_url: "https://media.example/shaft-thumb.webp", gallery_url: "https://media.example/shaft-gallery.webp" }], product_characteristics: [{ attribute: "Size", value: "1", order: 1 }], product_brands: [{ brands: { slug: "kamaz" } }], product_vehicle_types: [{ vehicle_type_slug: "truck" }] },
    { slug: "pump-item", name: "Pump Item", category_slug: "mixed", short_description: "short", description: null, article: null, meta_title: null, meta_description: null, order: 2, updated_at: "2026-01-02T00:00:00Z", subcategories: { slug: "pump" }, product_images: [], product_characteristics: [], product_brands: [{ brands: { slug: "kamaz" } }], product_vehicle_types: [] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockRejectedValue(new Error("editable source must not be used"));
  const list = vi.fn(async (kind: string) => rows[kind] ?? []);
  const get = vi.fn(async (kind: string, key: string) => rows[kind]?.find((row) =>
    kind === "subcategory" ? `[${JSON.stringify(row.category_slug)}, ${JSON.stringify(row.slug)}]` === key : row.slug === key) ?? null);
  vi.mocked(activeCatalogReaderIfEnabled).mockResolvedValue({
    list: list as unknown as CatalogPublicationReader["list"],
    get: get as unknown as CatalogPublicationReader["get"],
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("public query families over a publication", () => {
  it("maps categories and direct routes", async () => {
    expect((await getCategories()).map((row) => row.slug)).toEqual(["mixed", "flat"]);
    expect((await getBrandCategories("kamaz")).map((row) => row.slug)).toEqual(["mixed"]);
    expect(await getDirectProductCategorySlugs()).toEqual(new Set(["mixed", "flat"]));
  });
  it("maps subcategories including brand availability", async () => {
    expect((await getSubcategories("mixed"))[0].slug).toBe("pump");
    expect((await getSubcategory("mixed", "pump"))?.slug).toBe("pump");
    expect((await getAllSubcategories())[0].categorySlug).toBe("mixed");
    expect((await getBrandSubcategories("kamaz", "mixed")).map((row) => row.slug)).toEqual(["pump"]);
  });
  it("maps brand and category-brand records", async () => {
    expect((await getBrands())[0].slug).toBe("kamaz");
    expect((await getCategoryBrands("flat"))[0].logoScale).toBe(1.2);
    expect(await getCategoryBrandSlugs()).toEqual({ flat: ["kamaz"] });
  });
  it("maps vehicles and blank showcase hotspots", async () => {
    expect((await getVehicleTypes())[0].slug).toBe("truck");
    expect((await getVehicleShowcaseData())[0].hotspots[0].product).toBeNull();
  });
  it("keeps complete detail and sitemap SEO data", async () => {
    expect(await getProduct("shaft")).toMatchObject({ name: "Shaft", description: "full", metaTitle: "SEO", vehicleTypes: ["truck"], characteristics: [{ attribute: "Size", value: "1" }],
      images: [{ url: "https://media.example/shaft-gallery.webp", fallbackUrl: "https://media.example/shaft.jpg" }] });
    expect((await getSitemapProducts()).find((row) => row.slug === "shaft"))
      .toMatchObject({ slug: "shaft", updatedAt: "2026-01-01T00:00:00Z", images: [{ url: "https://media.example/shaft.jpg" }] });
  });
  it("fails closed when the reader fails", async () => {
    vi.mocked(activeCatalogReaderIfEnabled).mockRejectedValue(new Error("release unavailable"));
    await expect(getBrands()).rejects.toThrow("release unavailable");
    expect(createClient).not.toHaveBeenCalled();
  });
  it("does not use the editable product fallback when the release search RPC is missing", async () => {
    vi.stubEnv("AYPROM_PUBLIC_CATALOG_READ_MODE", "active");
    const from = vi.fn();
    vi.mocked(createClient).mockResolvedValue({
      rpc: vi.fn(() => ({ range: vi.fn().mockResolvedValue({ data: null,
        error: { code: "PGRST202", message: "missing" }, count: null }) })),
      from,
    } as never);
    await expect(getProducts({ categorySlug: "flat" })).rejects.toMatchObject({ code: "PGRST202" });
    expect(from).not.toHaveBeenCalled();
  });
  it("keeps the ProductPage shape and exact paging for active-release search", async () => {
    vi.stubEnv("AYPROM_PUBLIC_CATALOG_READ_MODE", "active");
    const range = vi.fn().mockResolvedValue({ data: [{ slug: "shaft", name: "Shaft", category_slug: "flat",
      subcategory_slug: null, short_description: "short", article: "A1", cover_url: null,
      cover_fallback_url: null, cover_scale: null, compatible_brands: ["kamaz"] }], error: null, count: 2 });
    const rpc = vi.fn(() => ({ range }));
    const from = vi.fn();
    vi.mocked(createClient).mockResolvedValue({ rpc, from } as never);
    expect(await getProducts({ categorySlug: "flat", page: 2, pageSize: 1 })).toEqual({
      items: [{ slug: "shaft", name: "Shaft", category: "flat", subcategory: undefined,
        compatibleBrands: ["kamaz"], images: [], shortDescription: "short", article: "A1" }],
      total: 2, page: 2, pageSize: 1, totalPages: 2,
    });
    expect(rpc).toHaveBeenCalledWith("search_catalog_products", expect.objectContaining({ category_filter: "flat" }), { count: "exact" });
    expect(range).toHaveBeenCalledExactlyOnceWith(1, 1);
    expect(from).not.toHaveBeenCalled();
  });
  it("rejects an unknown publication mode before any product request", async () => {
    vi.stubEnv("AYPROM_PUBLIC_CATALOG_READ_MODE", "typo");
    await expect(getProducts()).rejects.toThrow("Catalog publication unavailable");
    expect(createClient).not.toHaveBeenCalled();
  });
});
