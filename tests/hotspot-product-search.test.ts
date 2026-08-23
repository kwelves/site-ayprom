import { describe, expect, it } from "vitest";
import {
  HOTSPOT_PRODUCT_SEARCH_MAX_LENGTH,
  normalizeHotspotProductSearchQuery,
  selectAvailableHotspotProducts,
  type HotspotProductSearchRow,
} from "@/lib/admin/hotspot-product-search";

const products: HotspotProductSearchRow[] = [
  { id: "name-match", slug: "name-match", name: "Гидронасос", article: "A-1", published: true },
  { id: "article-match", slug: "article-match", name: "Насос", article: "HYD-42", published: true },
  { id: "draft", slug: "draft", name: "Гидронасос черновик", article: "A-2", published: false },
  { id: "taken", slug: "taken", name: "Гидронасос занятый", article: null, published: true },
];

const assignment = {
  id: "another-hotspot",
  product_id: "taken",
  vehicle_type_slug: "dump-truck",
  hotspot_number: 2,
  label: "Колесо",
  vehicle_types: { name: "Самосвал", order: 0 },
};

describe("selectAvailableHotspotProducts", () => {
  it("не отдаёт черновики, но возвращает уже используемые товары со всеми привязками", () => {
    const result = selectAvailableHotspotProducts({
      nameMatches: products,
      articleMatches: [],
      assignments: [assignment],
      limit: 8,
    });

    expect(result.map((product) => product.id)).toEqual(["name-match", "article-match", "taken"]);
    expect(result.at(-1)?.hotspotAssignments).toEqual([
      {
        id: assignment.id,
        vehicleTypeSlug: assignment.vehicle_type_slug,
        vehicleTypeName: assignment.vehicle_types.name,
        hotspotNumber: assignment.hotspot_number,
        label: assignment.label,
      },
    ]);
  });

  it("объединяет совпадения по названию и артикулу без дублей и уважает лимит", () => {
    const result = selectAvailableHotspotProducts({
      nameMatches: [products[0], products[1]],
      articleMatches: [products[1], products[3]],
      assignments: [],
      limit: 2,
    });

    expect(result.map((product) => product.id)).toEqual(["name-match", "article-match"]);
    expect(result.every((product) => product.hotspotAssignments.length === 0)).toBe(true);
  });
});

describe("normalizeHotspotProductSearchQuery", () => {
  it("не запрашивает базу для одного символа и отклоняет слишком длинный запрос", () => {
    expect(normalizeHotspotProductSearchQuery(" н ")).toBeNull();
    expect(() => normalizeHotspotProductSearchQuery("x".repeat(HOTSPOT_PRODUCT_SEARCH_MAX_LENGTH + 1))).toThrow(
      "Поисковый запрос не должен быть длиннее",
    );
  });
});
