import type { AdminAvailableProduct } from "@/lib/admin/queries";

export const HOTSPOT_PRODUCT_SEARCH_MIN_LENGTH = 2;
export const HOTSPOT_PRODUCT_SEARCH_MAX_LENGTH = 100;

export interface HotspotProductSearchRow {
  id: string;
  slug: string;
  name: string;
  article: string | null;
  published: boolean;
}

export interface HotspotProductAssignment {
  id: string;
  product_id: string;
}

export function normalizeHotspotProductSearchQuery(query: string): string | null {
  const term = query.trim();
  if (term.length < HOTSPOT_PRODUCT_SEARCH_MIN_LENGTH) return null;
  if (term.length > HOTSPOT_PRODUCT_SEARCH_MAX_LENGTH) {
    throw new Error(`Поисковый запрос не должен быть длиннее ${HOTSPOT_PRODUCT_SEARCH_MAX_LENGTH} символов.`);
  }
  return term;
}

// The database query already asks for published products, but retaining this
// condition in the pure mapper makes the visibility rule explicit and keeps a
// future query change from accidentally offering a draft to the admin.
export function selectAvailableHotspotProducts({
  nameMatches,
  articleMatches,
  assignments,
  currentHotspotId,
  limit,
}: {
  nameMatches: HotspotProductSearchRow[];
  articleMatches: HotspotProductSearchRow[];
  assignments: HotspotProductAssignment[];
  currentHotspotId?: string;
  limit: number;
}): AdminAvailableProduct[] {
  const assignedElsewhere = new Set(
    assignments
      .filter((assignment) => assignment.id !== currentHotspotId)
      .map((assignment) => assignment.product_id),
  );
  const uniqueMatches = new Map<string, AdminAvailableProduct>();
  for (const product of [...nameMatches, ...articleMatches]) {
    if (product.published && !assignedElsewhere.has(product.id) && !uniqueMatches.has(product.id)) {
      uniqueMatches.set(product.id, {
        id: product.id,
        slug: product.slug,
        name: product.name,
        article: product.article ?? undefined,
      });
    }
  }
  return [...uniqueMatches.values()].slice(0, limit);
}
