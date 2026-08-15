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

describe("selectAvailableHotspotProducts", () => {
  it("не отдаёт черновики и товары, закреплённые у другой точки", () => {
    const result = selectAvailableHotspotProducts({
      nameMatches: products,
      articleMatches: [],
      assignments: [{ id: "another-hotspot", product_id: "taken" }],
      limit: 8,
    });

    expect(result.map((product) => product.id)).toEqual(["name-match", "article-match"]);
  });

  it("оставляет товар текущего хотспота в его собственной выдаче", () => {
    const result = selectAvailableHotspotProducts({
      nameMatches: [products[3]],
      articleMatches: [],
      assignments: [{ id: "current-hotspot", product_id: "taken" }],
      currentHotspotId: "current-hotspot",
      limit: 8,
    });

    expect(result).toEqual([{ id: "taken", slug: "taken", name: "Гидронасос занятый", article: undefined }]);
  });

  it("объединяет совпадения по названию и артикулу без дублей и уважает лимит", () => {
    const result = selectAvailableHotspotProducts({
      nameMatches: [products[0], products[1]],
      articleMatches: [products[1], products[3]],
      assignments: [],
      limit: 2,
    });

    expect(result.map((product) => product.id)).toEqual(["name-match", "article-match"]);
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
