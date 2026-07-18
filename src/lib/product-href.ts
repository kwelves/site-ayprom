import type { Product } from "@/types/catalog";

// A product's "real" URL depends on which kind of category it's in —
// subcategory-type categories (hydraulic-pumps/tanks) nest products under
// /subcategory/[subSlug]/, brand-type categories (pto/pto-shafts) nest them
// under /brand/[brandSlug]/. General listings that aren't already scoped to
// one of those (e.g. the brand-agnostic /catalog/brand/[slug] page) need this
// to link to a page that actually exists instead of guessing.
//
// Takes categoryBrandSlugs (category slug -> its valid brand slugs) instead
// of querying Supabase itself, so callers that already loop over many
// products (search results, catalog listings) fetch that small lookup once
// instead of once per product.
export function getProductHref(product: Product, categoryBrandSlugs: Record<string, string[]>): string {
  if (product.subcategory) {
    return `/catalog/category/${product.category}/subcategory/${product.subcategory}/${product.slug}`;
  }

  const validBrandSlugs = categoryBrandSlugs[product.category];
  if (validBrandSlugs) {
    const matchingBrandSlug = product.compatibleBrands.find((slug) => validBrandSlugs.includes(slug));
    if (matchingBrandSlug) {
      return `/catalog/category/${product.category}/brand/${matchingBrandSlug}/${product.slug}`;
    }
  }

  // Data is incomplete for this product (e.g. no subcategory/brand set yet) —
  // send it somewhere real instead of a link that 404s.
  return "/catalog";
}
