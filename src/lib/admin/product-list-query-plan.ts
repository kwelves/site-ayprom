import type { ProductAvailability } from "@/lib/admin/product-availability";
import type { AdminProductListSort } from "@/lib/admin/product-list-config";

export interface AdminProductQueryPlanInput {
  q?: string;
  categorySlug?: string;
  published?: boolean;
  availability?: ProductAvailability;
  sort?: AdminProductListSort;
}

export interface AdminProductQueryPlan {
  equalityFilters: Array<{ column: string; value: string | boolean }>;
  searchExpression?: string;
  order: Array<{ column: string; ascending: boolean }>;
}

export function getAdminProductQueryPlan(filters: AdminProductQueryPlanInput = {}): AdminProductQueryPlan {
  const equalityFilters: AdminProductQueryPlan["equalityFilters"] = [];
  if (filters.categorySlug) equalityFilters.push({ column: "category_slug", value: filters.categorySlug });
  if (filters.published !== undefined) equalityFilters.push({ column: "published", value: filters.published });
  if (filters.availability) equalityFilters.push({ column: "availability", value: filters.availability });

  // PostgREST's or() parses commas/parens as filter syntax. Removing its
  // control characters keeps the search term inside the intended ilike pair.
  const term = filters.q?.trim().replace(/[%,()]/g, "");
  const primaryOrder =
    filters.sort === "name"
      ? { column: "name", ascending: true }
      : filters.sort === "updated"
        ? { column: "updated_at", ascending: false }
        : { column: "order", ascending: true };

  return {
    equalityFilters,
    searchExpression: term ? `name.ilike.%${term}%,article.ilike.%${term}%` : undefined,
    order: [primaryOrder, { column: "id", ascending: true }],
  };
}

export function findAdminProductTargetPageInRange(
  rows: ReadonlyArray<{ slug: string }>,
  targetSlug: string,
  rangeFrom: number,
  pageSize: number,
): number | null {
  const index = rows.findIndex((row) => row.slug === targetSlug);
  return index === -1 ? null : Math.floor((rangeFrom + index) / pageSize) + 1;
}

export async function findAdminProductTargetPageByRanges(
  targetSlug: string,
  pageSize: number,
  fetchRange: (from: number, to: number) => Promise<ReadonlyArray<{ slug: string }>>,
): Promise<number | null> {
  const resolvedPageSize = Math.max(1, Math.floor(pageSize));

  for (let page = 1; ; page += 1) {
    const from = (page - 1) * resolvedPageSize;
    const rows = await fetchRange(from, from + resolvedPageSize - 1);
    const targetPage = findAdminProductTargetPageInRange(rows, targetSlug, from, resolvedPageSize);
    if (targetPage !== null) return targetPage;
    if (rows.length < resolvedPageSize) return null;
  }
}
