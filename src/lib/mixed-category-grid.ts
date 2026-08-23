import type { ProductListItem, Subcategory } from "@/types/catalog";

export type MixedCategoryGridItem =
  | { kind: "subcategory"; item: Subcategory }
  | { kind: "product"; item: ProductListItem };

export function buildMixedCategoryGridItems(
  subcategories: Subcategory[],
  productsWithoutSubcategory: ProductListItem[],
): MixedCategoryGridItem[] {
  return [
    ...subcategories.map((item): MixedCategoryGridItem => ({ kind: "subcategory", item })),
    ...productsWithoutSubcategory.map((item): MixedCategoryGridItem => ({ kind: "product", item })),
  ];
}
