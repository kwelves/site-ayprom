// Pure, testable core of bulkUpdateProducts (actions.ts) — split out because
// "server-only" Server Actions can't be exercised directly by vitest (no
// existing actions.test.ts precedent in this codebase); this half has no
// such dependency.

import { isProductAvailability, type ProductAvailability } from "@/lib/admin/product-availability";

export interface BulkProductPatch {
  published?: boolean;
  availability?: ProductAvailability;
}

export function normalizeBulkProductSlugs(slugs: string[]): string[] {
  return [...new Set(slugs.map((s) => s.trim()).filter(Boolean))];
}

// Returns null for an empty/no-op patch — the caller should skip the
// database call entirely rather than issue an update with nothing in it.
export function buildBulkProductUpdateFields(patch: BulkProductPatch): Record<string, unknown> | null {
  const update: Record<string, unknown> = {};
  if (patch.published !== undefined) {
    update.published = patch.published;
  }
  if (patch.availability !== undefined) {
    if (!isProductAvailability(patch.availability)) {
      throw new Error("Недопустимый статус наличия.");
    }
    update.availability = patch.availability;
  }
  return Object.keys(update).length > 0 ? update : null;
}
