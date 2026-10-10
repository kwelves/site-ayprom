import { validateCatalogSnapshot, type CatalogSnapshot } from "../snapshot";
import type { CatalogPublicationExport } from "./catalog-publication-export";

/** Route inventory is a projection of the full sealed export, never a second source read. */
export function catalogSnapshotFromPublication(publication: CatalogPublicationExport): CatalogSnapshot {
  try {
    const docs = publication.documents;
    const categories = docs.category.map((row) => ({ slug: row.slug as string,
      name: row.name as string, type: row.type as "subcategory" | "brand" | null }));
    const subcategories = docs.subcategory.map((row) => ({ slug: row.slug as string,
      name: row.name as string, categorySlug: row.category_slug as string }));
    const brands = docs.brand.map((row) => ({ slug: row.slug as string, name: row.name as string }));
    const vehicleTypes = docs.vehicle_type.map((row) => ({ slug: row.slug as string, name: row.name as string }));
    const categoryBrands: Record<string, string[]> = {};
    for (const row of docs.category_brand) {
      (categoryBrands[row.category_slug as string] ??= []).push(row.brand_slug as string);
    }
    for (const list of Object.values(categoryBrands)) list.sort();
    const products = docs.product.map((row) => {
      const productBrands = row.product_brands as { brands: { slug: string } }[];
      const productVehicles = row.product_vehicle_types as { vehicle_type_slug: string }[];
      const images = row.product_images as { url: string; order: number; scale: number | null }[];
      const subcategory = row.subcategories as { slug: string } | null;
      return {
        slug: row.slug as string, name: row.name as string, category: row.category_slug as string,
        ...(subcategory?.slug ? { subcategory: subcategory.slug } : {}),
        compatibleBrands: productBrands.map((item) => item.brands.slug).sort(),
        vehicleTypes: productVehicles.map((item) => item.vehicle_type_slug).sort(),
        images: [...images].sort((a, b) => a.order - b.order || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
          .slice(0, 1).map((image) => ({ url: image.url,
            ...(image.scale === null ? {} : { scale: image.scale }) })),
        shortDescription: row.short_description as string,
        ...(row.article === null ? {} : { article: row.article as string }),
        updatedAt: row.updated_at as string,
      };
    });
    const snapshot: CatalogSnapshot = {
      schemaVersion: 1,
      snapshotId: publication.releaseId,
      categories, subcategories, brands, vehicleTypes, categoryBrands,
      directProductCategorySlugs: categories.filter((category) => category.type !== "brand")
        .map((category) => category.slug),
      products,
    };
    const validated = validateCatalogSnapshot(snapshot);
    if (!validated.ok) throw new Error();
    return validated.value;
  } catch { throw new Error("Catalog route snapshot unavailable"); }
}
