import { getProductHref } from "@/lib/product-href";
import type { ProductListItem } from "@/types/catalog";
import { routePathToOutputFile, type RouteManifestEntry } from "./route-manifest";

export interface CatalogRouteSource {
  snapshotId: string;
  categories: { slug: string; type: "subcategory" | "brand" | null }[];
  subcategories: { slug: string; categorySlug: string }[];
  brands: { slug: string }[];
  vehicleTypes: { slug: string }[];
  categoryBrands: Record<string, string[]>;
  directProductCategorySlugs: string[];
  products: (ProductListItem & { updatedAt: string })[];
}

export interface DerivedSitemapEntry {
  path: string;
  changeFrequency: "daily" | "weekly" | "monthly";
  priority: number;
  lastModified?: string;
  images?: string[];
}

export interface DerivedPublicRoutes {
  manifestEntries: RouteManifestEntry[];
  sitemapEntries: DerivedSitemapEntry[];
  blockers: { path: string; reason: "mixed_category_pagination_api_missing" }[];
}

export function derivePublicRoutes(
  source: CatalogRouteSource,
  siteUrl: string,
): DerivedPublicRoutes {
  const manifestEntries: RouteManifestEntry[] = [];
  const sitemapEntries: DerivedSitemapEntry[] = [];
  const blockers: DerivedPublicRoutes["blockers"] = [];
  const categoryBrandSlugs = source.categoryBrands;
  const directProductCategorySlugs = new Set(source.directProductCategorySlugs);
  const categoryTypes = new Map(source.categories.map((category) => [category.slug, category.type]));
  const subcategoryKeys = new Set(source.subcategories.map((subcategory) =>
    JSON.stringify([subcategory.categorySlug, subcategory.slug])));
  const brandCategoryPaths = new Set<string>();
  const brandSubcategoryPaths = new Set<string>();

  const addPage = (
    family: RouteManifestEntry["family"],
    path: string,
    routeClass: "static" | "query",
    includeInSitemap: Omit<DerivedSitemapEntry, "path"> | null,
    jsonLdTypes: string[] = ["BreadcrumbList"],
  ) => {
    manifestEntries.push({
      class: routeClass,
      family,
      path,
      outputFile: routePathToOutputFile(path),
      expectedCanonical: path === "/" ? siteUrl : `${siteUrl}${path}`,
      expectedJsonLdTypes: jsonLdTypes,
      expectedIndexable: true,
      snapshotIds: [source.snapshotId],
    });
    if (includeInSitemap) sitemapEntries.push({ path, ...includeInSitemap });
  };

  addPage("home", "/", "static", { changeFrequency: "weekly", priority: 1 }, ["WebSite", "AutoPartsStore"]);
  addPage("catalog", "/catalog", "query", { changeFrequency: "daily", priority: 0.9 }, []);
  addPage("about", "/about", "static", { changeFrequency: "monthly", priority: 0.5 }, []);
  addPage("contacts", "/contacts", "static", { changeFrequency: "monthly", priority: 0.6 }, []);

  for (const category of source.categories) {
    const categoryPath = `/catalog/category/${category.slug}`;
    addPage(
      "category", categoryPath,
      category.type === "brand" ? "static" : "query",
      { changeFrequency: "weekly", priority: 0.8 },
    );
  }
  for (const subcategory of source.subcategories) {
    addPage(
      "subcategory",
      `/catalog/category/${subcategory.categorySlug}/subcategory/${subcategory.slug}`,
      "query", { changeFrequency: "weekly", priority: 0.75 },
    );
  }
  for (const brand of source.brands) {
    addPage("brand", `/catalog/brand/${brand.slug}`, "static", { changeFrequency: "weekly", priority: 0.7 });
  }
  for (const vehicleType of source.vehicleTypes) {
    addPage("vehicle-type", `/catalog/vehicle-type/${vehicleType.slug}`, "query", { changeFrequency: "weekly", priority: 0.7 });
  }
  for (const [categorySlug, brandSlugs] of Object.entries(categoryBrandSlugs)) {
    for (const brandSlug of brandSlugs) {
      addPage("category-brand", `/catalog/category/${categorySlug}/brand/${brandSlug}`, "query", { changeFrequency: "weekly", priority: 0.7 });
    }
  }

  for (const product of source.products) {
    if (!categoryTypes.has(product.category) ||
      (product.subcategory && !subcategoryKeys.has(JSON.stringify([product.category, product.subcategory])))) {
      manifestEntries.push({
        class: "invalid",
        family: "product",
        path: `/product/${product.slug}`,
        reason: "snapshot_reference_invalid",
        snapshotIds: [product.slug],
      });
      continue;
    }
    if (categoryTypes.get(product.category) === "subcategory") {
      for (const brandSlug of product.compatibleBrands) {
        const brandCategoryPath = `/catalog/brand/${brandSlug}/category/${product.category}`;
        if (!brandCategoryPaths.has(brandCategoryPath)) {
          addPage("brand-category", brandCategoryPath, "static", null);
          brandCategoryPaths.add(brandCategoryPath);
        }
        if (product.subcategory) {
          const brandSubcategoryPath = `${brandCategoryPath}/subcategory/${product.subcategory}`;
          if (!brandSubcategoryPaths.has(brandSubcategoryPath)) {
            addPage("brand-category-subcategory", brandSubcategoryPath, "query", null);
            brandSubcategoryPaths.add(brandSubcategoryPath);
          }
        }
      }
    }
    const canonicalPath = getProductHref(
      product,
      categoryBrandSlugs,
      directProductCategorySlugs,
    );
    const servedPaths = new Set<string>();
    if (product.subcategory) {
      servedPaths.add(`/catalog/category/${product.category}/subcategory/${product.subcategory}/${product.slug}`);
    }
    for (const brandSlug of categoryBrandSlugs[product.category] ?? []) {
      if (product.compatibleBrands.includes(brandSlug)) {
        servedPaths.add(`/catalog/category/${product.category}/brand/${brandSlug}/${product.slug}`);
      }
    }
    if (!product.subcategory && directProductCategorySlugs.has(product.category)) {
      servedPaths.add(`/catalog/category/${product.category}/${product.slug}`);
    }
    if (canonicalPath === "/catalog") {
      // Same as production (getProductHref): data without a resolvable page sends the visitor to
      // the catalog. No product page and no sitemap entry exist for it.
      manifestEntries.push({
        class: "redirect",
        family: "product-alias",
        path: `/product/${product.slug}`,
        redirectTo: "/catalog",
        status: 308,
        snapshotIds: [product.slug],
      });
      continue;
    }
    for (const path of servedPaths) {
      manifestEntries.push({
        class: "static",
        family: "product",
        path,
        outputFile: routePathToOutputFile(path),
        expectedCanonical: `${siteUrl}${path}`,
        expectedJsonLdTypes: ["BreadcrumbList"],
        expectedIndexable: true,
        snapshotIds: [product.slug],
      });
    }
    manifestEntries.push({
      class: "redirect",
      family: "product-alias",
      path: `/product/${product.slug}`,
      redirectTo: canonicalPath,
      status: 308,
      snapshotIds: [product.slug],
    });
    sitemapEntries.push({
      path: canonicalPath,
      lastModified: product.updatedAt,
      changeFrequency: "weekly",
      priority: 0.8,
      images: product.images[0]?.url
        ? [product.images[0].url.startsWith("http")
          ? product.images[0].url
          : `${siteUrl}${product.images[0].url}`]
        : undefined,
    });
  }

  for (const [family, path] of [
    ["robots", "/robots.txt"],
    ["sitemap", "/sitemap.xml"],
    ["not-found", "/404"],
  ] as const) {
    manifestEntries.push({
      class: "static",
      family,
      path,
      outputFile: routePathToOutputFile(path),
      expectedCanonical: null,
      expectedJsonLdTypes: [],
      expectedIndexable: false,
      snapshotIds: [source.snapshotId],
    });
  }

  return { manifestEntries, sitemapEntries, blockers };
}
