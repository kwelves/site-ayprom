// Isomorphic (no "use client"/"use server"), same reasoning as
// product-photo-mode.ts: shared by the server queries that read the column,
// the Server Action that parses form input, and client components that
// render the badge/toggle.

export type ProductAvailability = "in_stock" | "out_of_stock" | "unclear";

export const DEFAULT_PRODUCT_AVAILABILITY: ProductAvailability = "in_stock";

const VALID_AVAILABILITIES: readonly ProductAvailability[] = ["in_stock", "out_of_stock", "unclear"];

export function isProductAvailability(value: string | undefined | null): value is ProductAvailability {
  return !!value && (VALID_AVAILABILITIES as readonly string[]).includes(value);
}

// Информационная метка — не скрывает товар из публичного каталога/поиска,
// см. PROJECT_BRIEF: наличие влияет только на отображение бейджа.
export const PRODUCT_AVAILABILITY_LABELS: Record<ProductAvailability, string> = {
  in_stock: "В наличии",
  out_of_stock: "Нет в наличии",
  unclear: "Уточнить",
};

export const PRODUCT_AVAILABILITY_OPTIONS: readonly ProductAvailability[] = VALID_AVAILABILITIES;
