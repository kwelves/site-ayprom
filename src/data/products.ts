import type { Product } from "@/types/catalog";

// Deliberately incomplete test product — only the required fields are
// filled in (name, category/subcategory, image, shortDescription), the rest
// (article, description, characteristics, compatibleBrands) are left empty
// on purpose to verify the product page hides those blocks cleanly instead
// of breaking, before real catalog data exists.
export const products: Product[] = [
  {
    slug: "ay-gp110",
    name: "Шестерённый насос AY-GP110",
    category: "hydraulic-pumps",
    subcategory: "gear-pumps",
    compatibleBrands: [],
    // Same photo repeated — stand-in gallery just to test the carousel
    // switching between multiple images, not 5 distinct real product shots.
    images: Array(5).fill("/category-hydraulic-pumps/1-gear-pumps.jpg"),
    shortDescription: "Шестерённый гидравлический насос для навесного оборудования спецтехники.",
  },
];
