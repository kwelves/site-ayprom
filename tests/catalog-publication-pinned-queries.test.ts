import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProducts, getProduct } from "@/lib/queries/products";
import { getCategories } from "@/lib/queries/categories";
import { createClient } from "@/lib/supabase/server";
import { loadCatalogPublicationFile } from "@/lib/catalog-publication-file";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/catalog-publication-file", () => ({ loadCatalogPublicationFile: vi.fn() }));

const releaseId = "20000000-0000-4000-8000-000000000001";
const base = { short_description: "short", description: "full", article: null,
  meta_title: "SEO", meta_description: "desc", updated_at: "2026-01-01T00:00:00Z",
  product_images: [], product_characteristics: [], product_brands: [], product_vehicle_types: [] };
const publication = { format: 1, releaseId, revision: 4, sha256: "a".repeat(64), documentCount: 4,
  documents: {
    category: [{ slug: "flat", name: "Flat", description: "", icon: "pto", image: "", intro: null, type: null, order: 1 }],
    subcategory: [], brand: [], category_brand: [], vehicle_type: [], vehicle_hotspot: [],
    product: [
      { ...base, slug: "one", name: "One", category_slug: "flat", order: 1, subcategories: null },
      { ...base, slug: "two", name: "Two", category_slug: "flat", order: 2, subcategories: null },
      { ...base, slug: "other", name: "Other", category_slug: "other", order: 3, subcategories: null },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AYPROM_PUBLIC_CATALOG_READ_MODE", "pinned");
  vi.stubEnv("AYPROM_STATIC_BUILD", "1");
  vi.stubEnv("AYPROM_PUBLIC_CATALOG_EXPORT_PATH", "C:\\repo\\dist\\staging\\20261007T000000Z-aaaaaaaa\\meta\\catalog-publication-export.json");
  vi.stubEnv("AYPROM_PUBLIC_CATALOG_EXPORT_SHA256", "b".repeat(64));
  vi.stubEnv("AYPROM_PUBLIC_CATALOG_RELEASE_ID", releaseId);
  vi.mocked(createClient).mockRejectedValue(new Error("source forbidden"));
  vi.mocked(loadCatalogPublicationFile).mockResolvedValue(publication as never);
});
afterEach(() => vi.unstubAllEnvs());

describe("Next pinned build queries", () => {
  it("reads categories and a complete product detail without Supabase", async () => {
    expect((await getCategories()).map((row) => row.slug)).toEqual(["flat"]);
    expect(await getProduct("one")).toMatchObject({ name: "One", description: "full", metaTitle: "SEO" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("keeps exact ProductPage filtering and pagination from the same export", async () => {
    expect(await getProducts({ categorySlug: "flat", page: 2, pageSize: 1 })).toEqual({
      items: [{ slug: "two", name: "Two", category: "flat", subcategory: undefined,
        compatibleBrands: [], images: [], shortDescription: "short", article: undefined }],
      total: 2, page: 2, pageSize: 1, totalPages: 2,
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("never falls back to the active release or editable source on file failure", async () => {
    vi.mocked(loadCatalogPublicationFile).mockRejectedValue(new Error("file missing"));
    await expect(getProducts()).rejects.toThrow("Catalog publication unavailable");
    expect(createClient).not.toHaveBeenCalled();
  });
});
