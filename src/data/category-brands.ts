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
// card's box is a much bigger aspect-4/3 frame, so the same factor can
// overflow it. Only brands that actually need a different value here are
// listed; everything else falls back to brand.logoScale.
export const categoryCardLogoScale: Partial<Record<string, number>> = {
  "renault-trucks": 1,
  "mercedes-benz": 1.15,
};
