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
//
// A product may fit several brands that are all valid for its category, so
// several /brand/<slug>/ URLs serve it. Exactly one of them is the primary
// (sitemap, /product/<slug> redirect, listing links), and that choice must not
// depend on the order Supabase, a frozen snapshot, or the search API happened
// to return compatibleBrands / category_brands in. The primary is the smallest
// matching slug by plain code-unit comparison — see pickPrimaryBrandSlug.
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
    const primaryBrandSlug = pickPrimaryBrandSlug(product.compatibleBrands, validBrandSlugs);
    if (primaryBrandSlug !== undefined) {
      return `/catalog/category/${product.category}/brand/${primaryBrandSlug}/${product.slug}`;
    }
  }

  if (directProductCategorySlugs.has(product.category)) {
    return `/catalog/category/${product.category}/${product.slug}`;
  }

  // Data is incomplete for this product (e.g. no subcategory/brand set yet) —
  // send it somewhere real instead of a link that 404s.
  return "/catalog";
}

// Smallest slug in the intersection of compatibleBrands and validBrandSlugs.
// Order is the plain `<` comparison of UTF-16 code units: it is fixed across
// runtimes and locales, unlike localeCompare/Intl.Collator whose result depends
// on ICU data and the default locale. Slugs are ASCII so this is also plain
// code-point order. Duplicates fall out naturally, and nothing is sorted in
// place, so the caller's arrays are never mutated.
function pickPrimaryBrandSlug(
  compatibleBrands: readonly string[],
  validBrandSlugs: readonly string[],
): string | undefined {
  const valid = new Set(validBrandSlugs);
  let primary: string | undefined;
  for (const slug of compatibleBrands) {
    if (!valid.has(slug)) continue;
    if (primary === undefined || slug < primary) primary = slug;
  }
  return primary;
}
