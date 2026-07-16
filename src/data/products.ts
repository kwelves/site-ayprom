import type { Product } from "@/types/catalog";

// Deliberately incomplete test product data — only the required fields are
// filled in (name, category/subcategory, image, shortDescription, one
// compatible brand), the rest (article, description, characteristics) are
// left empty on purpose to verify the product page hides those blocks
// cleanly instead of breaking, before real catalog data exists.
//
// 12 variants (sequential model numbers AY-GP110..AY-GP121, one randomly
// assigned brand each) to exercise the grid, search, and brand pages with
// more than a single duplicated item. Drop this generator (or delete the
// file) once real products replace it.
const testCompatibleBrandSlugs = [
  "daf",
  "kamaz",
  "volvo",
  "man",
  "isuzu",
  "scania",
  "howo",
  "mercedes-benz",
  "shacman",
  "zf",
  "foton",
  "renault-trucks",
];

// Half the test products also fit a second, non-primary brand — this is
// what exercises the "Совместимо с" tier on that second brand's page
// (mainBrand stays the first/primary brand above). undefined = single-brand
// product, same as before.
const testSecondaryBrandSlugs: (string | undefined)[] = [
  "man",
  undefined,
  "howo",
  undefined,
  "daf",
  undefined,
  "zf",
  undefined,
  "volvo",
  undefined,
  "kamaz",
  undefined,
];

// Left undefined on a third of the products on purpose, to keep verifying
// the manufacturer block hides cleanly when the field isn't filled in yet.
const testManufacturers: (string | undefined)[] = [
  "Bosch Rexroth",
  "Parker Hannifin",
  undefined,
  "Casappa",
  "Bondioli & Pavesi",
  undefined,
  "Bosch Rexroth",
  "Parker Hannifin",
  undefined,
  "Casappa",
  "Bondioli & Pavesi",
  undefined,
];

export const products: Product[] = Array.from({ length: 12 }, (_, i) => {
  const model = 110 + i;
  const mainBrand = testCompatibleBrandSlugs[i];
  const secondaryBrand = testSecondaryBrandSlugs[i];
  return {
    slug: `ay-gp${model}`,
    name: `Шестерённый насос AY-GP${model}`,
    category: "hydraulic-pumps",
    subcategory: "gear-pumps",
    compatibleBrands: secondaryBrand ? [mainBrand, secondaryBrand] : [mainBrand],
    mainBrand,
    manufacturer: testManufacturers[i],
    images: Array(5).fill("/category-hydraulic-pumps/1-gear-pumps.jpg"),
    shortDescription: "Шестерённый гидравлический насос для навесного оборудования спецтехники.",
  };
});
