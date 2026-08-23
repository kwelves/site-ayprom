import { describe, expect, it } from "vitest";
import { categorySupportsDirectProducts } from "@/lib/category-routing";

describe("categorySupportsDirectProducts", () => {
  it("разрешает товары без подкатегории в прямых и смешанных категориях", () => {
    expect(categorySupportsDirectProducts(null)).toBe(true);
    expect(categorySupportsDirectProducts("subcategory")).toBe(true);
  });

  it("сохраняет обязательный брендовый маршрут для категории по брендам", () => {
    expect(categorySupportsDirectProducts("brand")).toBe(false);
  });
});
