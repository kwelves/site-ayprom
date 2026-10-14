import type { MetadataRoute } from "next";
import { getBrands } from "@/lib/queries/brands";
import { getCategories } from "@/lib/queries/categories";
import { getAllSubcategories } from "@/lib/queries/subcategories";
import { getVehicleTypes } from "@/lib/queries/vehicle-types";
import { getCategoryBrandSlugs } from "@/lib/queries/category-brands";
import { getDirectProductCategorySlugs } from "@/lib/queries/categories";
import { getSitemapProducts } from "@/lib/queries/products";
import { getSiteUrl } from "@/lib/site-url";
import { derivePublicRoutes } from "@/cloudflare/static-build/derive-routes";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getSiteUrl();
  const [categories, subcategories, brands, vehicleTypes, categoryBrandSlugs, directProductCategorySlugs, products] = await Promise.all([
    getCategories(),
    getAllSubcategories(),
    getBrands(),
    getVehicleTypes(),
    getCategoryBrandSlugs(),
    getDirectProductCategorySlugs(),
    getSitemapProducts(),
  ]);
  const { sitemapEntries } = derivePublicRoutes({
    snapshotId: "legacy-sitemap",
    categories,
    subcategories,
    brands,
    vehicleTypes,
    categoryBrands: categoryBrandSlugs,
    directProductCategorySlugs: [...directProductCategorySlugs],
    products,
  }, baseUrl);
  return sitemapEntries.map(({ path, ...entry }) => ({
    url: `${baseUrl}${path === "/" ? "" : path}`,
    ...entry,
  }));
}
