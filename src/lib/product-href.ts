import type { ProductListItem } from "@/types/catalog";

// A product's "real" URL depends on which kind of category it's in —
// subcategory-type categories (hydraulic-pumps/tanks) nest products under
// /subcategory/[subSlug]/, brand-type categories (pto/pto-shafts) nest them
// under /brand/[brandSlug]/, and "direct" categories (type = NULL) link
// straight under the category itself with no extra segment. General
// listings that aren't already scoped to one of those (e.g. the
// brand-agnostic /catalog/brand/[slug] page) need this to link to a page
// that actually exists instead of guessing.
//
// Takes categoryBrandSlugs (category slug -> its valid brand slugs) and the
// categories that allow products without a subcategory instead of querying
// Supabase itself, so callers that loop over many products fetch those small
// lookups once instead of once per product.
export function getProductHref(
  product: ProductListItem,
  categoryBrandSlugs: Record<string, string[]>,
  directProductCategorySlugs: Set<string>,
): string {
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

  if (directProductCategorySlugs.has(product.category)) {
    return `/catalog/category/${product.category}/${product.slug}`;
  }

  // Data is incomplete for this product (e.g. no subcategory/brand set yet) —
  // send it somewhere real instead of a link that 404s.
  return "/catalog";
}
