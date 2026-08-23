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
  vehicle_type_slug: string;
  hotspot_number: number;
  label: string;
  vehicle_types: { name: string; order: number } | null;
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
  limit,
}: {
  nameMatches: HotspotProductSearchRow[];
  articleMatches: HotspotProductSearchRow[];
  assignments: HotspotProductAssignment[];
  limit: number;
}): AdminAvailableProduct[] {
  const assignmentsByProduct = new Map<string, HotspotProductAssignment[]>();
  for (const assignment of assignments) {
    const current = assignmentsByProduct.get(assignment.product_id) ?? [];
    current.push(assignment);
    assignmentsByProduct.set(assignment.product_id, current);
  }

  const uniqueMatches = new Map<string, AdminAvailableProduct>();
  for (const product of [...nameMatches, ...articleMatches]) {
    if (product.published && !uniqueMatches.has(product.id)) {
      const productAssignments = [...(assignmentsByProduct.get(product.id) ?? [])].sort(
        (left, right) =>
          (left.vehicle_types?.order ?? Number.MAX_SAFE_INTEGER) -
            (right.vehicle_types?.order ?? Number.MAX_SAFE_INTEGER) ||
          left.hotspot_number - right.hotspot_number ||
          left.id.localeCompare(right.id),
      );
      uniqueMatches.set(product.id, {
        id: product.id,
        slug: product.slug,
        name: product.name,
        article: product.article ?? undefined,
        hotspotAssignments: productAssignments.map((assignment) => ({
          id: assignment.id,
          vehicleTypeSlug: assignment.vehicle_type_slug,
          vehicleTypeName: assignment.vehicle_types?.name ?? assignment.vehicle_type_slug,
          hotspotNumber: assignment.hotspot_number,
          label: assignment.label,
        })),
      });
    }
  }
  return [...uniqueMatches.values()].slice(0, limit);
}
