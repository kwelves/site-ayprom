// Shared sizing system for category-split pages (subcategory grids, brand
// grids). Card size is driven purely by how many cards are on the page, not
// by which page it is — so any category with the same item count looks the
// same. Max row width is 4, and items beyond a full row of 4 wrap onto a
// centered next row at the same size (flexbox wrap + justify-center centers
// incomplete rows; CSS grid doesn't).
export interface CategoryGridSizing {
  /** Width classes for each card's wrapper, sized so `columns` fit per row. */
  itemClassName: string;
  /** Photo padding inside the card — same "homepage catalog card" look at every count. */
  imageClassName: string;
  /** Name font size inside the card — a touch smaller once cards get denser at 4-up. */
  nameClassName: string;
  /** Narrows the row itself for small counts, so 2 cards don't stretch thin
   * across the full container. */
  narrowContainer: boolean;
}

export function getCategoryGridSizing(itemCount: number): CategoryGridSizing {
  const columns = Math.min(itemCount, 4);
  const compact = columns >= 4;

  const itemClassName =
    columns <= 2
      ? "w-[calc(50%-0.5rem)] shrink-0 sm:w-[calc(50%-0.75rem)] lg:w-[calc(50%-1rem)]"
      : columns === 3
        ? "w-[calc(33.3333%-0.6667rem)] shrink-0 sm:w-[calc(33.3333%-1rem)] lg:w-[calc(33.3333%-1.3333rem)]"
        : "w-[calc(25%-0.75rem)] shrink-0 sm:w-[calc(25%-1.125rem)] lg:w-[calc(25%-1.5rem)]";

  return {
    itemClassName,
    imageClassName: "p-5",
    nameClassName: compact ? "text-sm font-medium" : "text-base font-medium",
    narrowContainer: columns <= 2,
  };
}
