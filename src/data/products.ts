import type { Product } from "@/types/catalog";

// Deliberately incomplete test product — only the required fields are
// filled in (name, category/subcategory, image, shortDescription), the rest
// (article, description, characteristics, compatibleBrands) are left empty
// on purpose to verify the product page hides those blocks cleanly instead
// of breaking, before real catalog data exists.
//
// Duplicated 12x (same data, different slugs) to preview what a fuller grid
// looks like, and to have enough test items once the admin panel exists.
// Drop back to a single entry (or delete this file) once real products
// replace it.
export const products: Product[] = Array.from({ length: 12 }, (_, i) => ({
  slug: i === 0 ? "ay-gp110" : `ay-gp110-${i + 1}`,
  name: "Шестерённый насос AY-GP110",
  category: "hydraulic-pumps",
  subcategory: "gear-pumps",
  compatibleBrands: [],
  images: Array(5).fill("/category-hydraulic-pumps/1-gear-pumps.jpg"),
  shortDescription: "Шестерённый гидравлический насос для навесного оборудования спецтехники.",
}));
