import type { AdminProductHotspotOption, AdminProductListItem } from "@/lib/admin/queries";
import type { ProductAvailability } from "@/lib/admin/product-availability";

export interface ProductPublicationState {
  products: AdminProductListItem[];
  hotspotOptions: AdminProductHotspotOption[];
}

/**
 * Mirrors the database's unpublish behavior in the optimistic UI: unpublishing
 * also detaches every selected product from its hotspot. The input arrays and
 * rows stay untouched so callers can keep them as an exact rollback snapshot.
 */
export function applyOptimisticProductPatch(
  products: AdminProductListItem[],
  hotspotOptions: AdminProductHotspotOption[],
  slugs: readonly string[],
  patch: { published?: boolean; availability?: ProductAvailability },
): ProductPublicationState {
  const selectedSlugs = new Set(slugs);
  const selectedProductIds = new Set(products.filter((product) => selectedSlugs.has(product.slug)).map((product) => product.id));
  const detachesHotspots = patch.published === false;

  return {
    products: products.map((product) => {
      if (!selectedSlugs.has(product.slug)) return product;
      return detachesHotspots
        ? { ...product, ...patch, hotspotCount: 0 }
        : { ...product, ...patch };
    }),
    hotspotOptions: detachesHotspots
      ? hotspotOptions.map((hotspot) =>
          hotspot.product && selectedProductIds.has(hotspot.product.id) ? { ...hotspot, product: null } : hotspot,
        )
      : hotspotOptions,
  };
}
