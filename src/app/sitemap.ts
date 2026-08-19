import type { MetadataRoute } from "next";
import { getBrands } from "@/lib/queries/brands";
import { getCategories } from "@/lib/queries/categories";
import { getAllSubcategories } from "@/lib/queries/subcategories";
import { getVehicleTypes } from "@/lib/queries/vehicle-types";
import { getCategoryBrandSlugs } from "@/lib/queries/category-brands";
import { getDirectCategorySlugs } from "@/lib/queries/categories";
import { getSitemapProducts } from "@/lib/queries/products";
import { getProductHref } from "@/lib/product-href";
import { getSiteUrl } from "@/lib/site-url";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getSiteUrl();
  const [categories, subcategories, brands, vehicleTypes, categoryBrandSlugs, directCategorySlugs, products] = await Promise.all([
    getCategories(),
    getAllSubcategories(),
    getBrands(),
    getVehicleTypes(),
    getCategoryBrandSlugs(),
    getDirectCategorySlugs(),
    getSitemapProducts(),
  ]);
  const entries = new Map<string, MetadataRoute.Sitemap[number]>();
  const add = (path: string, entry: Omit<MetadataRoute.Sitemap[number], "url"> = {}) => {
    const url = `${baseUrl}${path}`;
    entries.set(url, { url, ...entry });
  };

  add("", { changeFrequency: "weekly", priority: 1 });
  add("/catalog", { changeFrequency: "daily", priority: 0.9 });
  add("/about", { changeFrequency: "monthly", priority: 0.5 });
  add("/contacts", { changeFrequency: "monthly", priority: 0.6 });

  for (const category of categories) {
    add(`/catalog/category/${category.slug}`, { changeFrequency: "weekly", priority: 0.8 });
  }
  for (const subcategory of subcategories) {
    add(`/catalog/category/${subcategory.categorySlug}/subcategory/${subcategory.slug}`, {
      changeFrequency: "weekly",
      priority: 0.75,
    });
  }
  for (const brand of brands) {
    add(`/catalog/brand/${brand.slug}`, { changeFrequency: "weekly", priority: 0.7 });
  }
  for (const vehicleType of vehicleTypes) {
    add(`/catalog/vehicle-type/${vehicleType.slug}`, { changeFrequency: "weekly", priority: 0.7 });
  }
  for (const [categorySlug, brandSlugs] of Object.entries(categoryBrandSlugs)) {
    for (const brandSlug of brandSlugs) {
      add(`/catalog/category/${categorySlug}/brand/${brandSlug}`, {
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
  }
  for (const product of products) {
    const canonicalPath = getProductHref(product, categoryBrandSlugs, directCategorySlugs);
    if (canonicalPath === "/catalog") continue;
    add(canonicalPath, {
      lastModified: product.updatedAt,
      changeFrequency: "weekly",
      priority: 0.8,
      images: product.images[0]?.url
        ? [
            product.images[0].url.startsWith("http")
              ? product.images[0].url
              : `${baseUrl}${product.images[0].url}`,
          ]
        : undefined,
    });
  }

  return [...entries.values()];
}
