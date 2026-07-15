import { brands } from "@/data/brands";
import type { Brand } from "@/types/catalog";

// Explicit slug order, independent of the master `brands` array's own order —
// so re-sorting brands.ts for unrelated reasons can't silently reorder this grid.
const comAndShaftBrandSlugs = [
  "daf",
  "man",
  "scania",
  "maz",
  "kamaz",
  "renault-trucks",
  "mercedes-benz",
  "volvo",
];

const comAndShaftBrands: Brand[] = comAndShaftBrandSlugs
  .map((slug) => brands.find((brand) => brand.slug === slug))
  .filter((brand): brand is Brand => Boolean(brand));

export const brandsByCategory: Record<string, Brand[]> = {
  pto: comAndShaftBrands,
  "pto-shafts": comAndShaftBrands,
};

// Brand.logoScale is tuned for the small homepage badge (BrandSection) — this
// card's box is a much bigger 2:1 frame, so the same factor can look very
// different here. Only brands that actually need a different value in this
// card are listed; everything else falls back to brand.logoScale.
export const categoryCardLogoScale: Partial<Record<string, number>> = {
  daf: 1.3,
  kamaz: 1.3,
  "renault-trucks": 1.3,
  "mercedes-benz": 1.3,
};
