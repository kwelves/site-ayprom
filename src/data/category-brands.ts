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
  "zf",
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
// different here. All 8 logos happen to be height-bound at this box's aspect
// ratio (2:1 is wide enough that even the widest logo, MAZ, doesn't hit the
// width first), so one uniform scale works for all of them — 1.15 is the
// practical safe ceiling before the tallest ones start touching the card's
// own edge (bigger risks visible clipping or bleeding into the name below).
export const categoryCardLogoScale: Partial<Record<string, number>> = {
  daf: 1.15,
  man: 0.95,
  scania: 0.95,
  maz: 0.95,
  kamaz: 1.15,
  "renault-trucks": 1.3,
  "mercedes-benz": 1.15,
  volvo: 1.15,
};
