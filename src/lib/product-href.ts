import { subcategoriesByCategory } from "@/data/subcategories";
import { brandsByCategory } from "@/data/category-brands";
import type { Product } from "@/types/catalog";

// A product's "real" URL depends on which kind of category it's in —
// subcategory-type categories (hydraulic-pumps/tanks) nest products under
// /subcategory/[subSlug]/, brand-type categories (pto/pto-shafts) nest them
// under /brand/[brandSlug]/. General listings that aren't already scoped to
// one of those (e.g. the brand-agnostic /catalog/brand/[slug] page) need this
// to link to a page that actually exists instead of guessing.
export function getProductHref(product: Product): string {
  if (product.subcategory && subcategoriesByCategory[product.category]) {
    return `/catalog/category/${product.category}/subcategory/${product.subcategory}/${product.slug}`;
  }

  const categoryBrands = brandsByCategory[product.category];
  if (categoryBrands) {
    const matchingBrand = categoryBrands.find((brand) => product.compatibleBrands.includes(brand.slug));
    if (matchingBrand) {
      return `/catalog/category/${product.category}/brand/${matchingBrand.slug}/${product.slug}`;
    }
  }

  // Data is incomplete for this product (e.g. no subcategory/brand set yet) —
  // send it somewhere real instead of a link that 404s.
  return "/catalog";
}
