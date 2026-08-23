import type { Category } from "@/types/catalog";

export function categorySupportsDirectProducts(type: Category["type"]): boolean {
  return type !== "brand";
}
