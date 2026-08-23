import { describe, expect, it, vi } from "vitest";
import {
  findAdminProductTargetPageByRanges,
  findAdminProductTargetPageInRange,
  getAdminProductQueryPlan,
} from "@/lib/admin/product-list-query-plan";

describe("admin product list query plan", () => {
  it.each([
    ["order", { column: "order", ascending: true }],
    ["name", { column: "name", ascending: true }],
    ["updated", { column: "updated_at", ascending: false }],
  ] as const)("uses the same stable ordering for %s", (sort, primary) => {
    expect(getAdminProductQueryPlan({ sort }).order).toEqual([
      primary,
      { column: "id", ascending: true },
    ]);
  });

  it("keeps all filters in one plan and sanitizes PostgREST search syntax", () => {
    expect(
      getAdminProductQueryPlan({
        q: "  pump,(100%) ",
        categorySlug: "parts",
        published: false,
        availability: "unclear",
      }),
    ).toMatchObject({
      equalityFilters: [
        { column: "category_slug", value: "parts" },
        { column: "published", value: false },
        { column: "availability", value: "unclear" },
      ],
      searchExpression: "name.ilike.%pump100%,article.ilike.%pump100%",
    });
  });

  it("computes the second page for a target beyond a 50-row boundary", () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({ slug: `product-${index + 1}` }));
    expect(findAdminProductTargetPageInRange(rows.slice(0, 50), "product-51", 0, 50)).toBeNull();
    expect(findAdminProductTargetPageInRange(rows.slice(50), "product-51", 50, 50)).toBe(2);
  });

  it("scans inclusive ranges until the target is found on a later page", async () => {
    const ranges: Array<[number, number]> = [];
    const rows = Array.from({ length: 51 }, (_, index) => ({ slug: `product-${index + 1}` }));

    const page = await findAdminProductTargetPageByRanges("product-51", 50, async (from, to) => {
      ranges.push([from, to]);
      return rows.slice(from, to + 1);
    });

    expect(page).toBe(2);
    expect(ranges).toEqual([[0, 49], [50, 99]]);
  });

  it("stops after the first short range when the target is absent", async () => {
    const fetchRange = vi.fn(async () => [{ slug: "only-product" }]);
    await expect(findAdminProductTargetPageByRanges("missing", 50, fetchRange)).resolves.toBeNull();
    expect(fetchRange).toHaveBeenCalledOnce();
    expect(fetchRange).toHaveBeenCalledWith(0, 49);
  });
});
