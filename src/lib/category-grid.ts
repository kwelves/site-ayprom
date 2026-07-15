// Shared sizing system for category-split pages (subcategory grids, brand
// grids). Below the lg breakpoint (1024px) the grid is always 2-up,
// regardless of item count — mobile and tablet get the same compact layout.
// The "real" column count (min(itemCount, 4)) only kicks in at lg and above.
// Items beyond a full row wrap onto a centered next row at the same size
// (flexbox wrap + justify-center centers incomplete rows; CSS grid doesn't).
export interface CategoryGridSizing {
  /** Width classes for each card's wrapper — 2-up below lg, `columns`-up at lg. */
  itemClassName: string;
  /** Photo padding inside the card — same "homepage catalog card" look at every count. */
  imageClassName: string;
  /** Name font size inside the card — a touch smaller once cards get denser at 4-up. */
  nameClassName: string;
  /** Classes for the row container itself — narrowed below lg (since it's
   * always 2-up there) and, for 2-item categories, still narrowed at lg too
   * so 2 cards don't stretch thin across the full container; 3/4-item
   * categories release back to the full container width at lg. */
  containerClassName: string;
}

export function getCategoryGridSizing(itemCount: number): CategoryGridSizing {
  const columns = Math.min(itemCount, 4);
  const compact = columns >= 4;

  const lgWidth =
    columns <= 2
      ? "lg:w-[calc(50%-1rem)]"
      : columns === 3
        ? "lg:w-[calc(33.3333%-1.3333rem)]"
        : "lg:w-[calc(25%-1.5rem)]";

  const itemClassName = `w-[calc(50%-0.5rem)] shrink-0 sm:w-[calc(50%-0.75rem)] ${lgWidth}`;

  const containerClassName = columns <= 2 ? "mx-auto max-w-3xl" : "mx-auto max-w-3xl lg:max-w-none";

  return {
    itemClassName,
    imageClassName: "p-5",
    nameClassName: compact ? "text-sm font-medium" : "text-base font-medium",
    containerClassName,
  };
}
