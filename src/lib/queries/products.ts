import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Product } from "@/types/catalog";

const PRODUCT_SELECT = `
  slug, name, category_slug, short_description, description, article,
  subcategories(slug),
  product_images(url, "order", scale),
  product_characteristics(attribute, value, "order"),
  product_brands(brands(slug, name, country, logo, logo_scale)),
  product_vehicle_types(vehicle_type_slug)
`;

interface ProductRow {
  slug: string;
  name: string;
  category_slug: string;
  short_description: string;
  description: string | null;
  article: string | null;
  subcategories: { slug: string } | null;
  product_images: { url: string; order: number; scale: number | null }[];
  product_characteristics: { attribute: string; value: string; order: number }[];
  product_brands: { brands: { slug: string } }[];
  product_vehicle_types: { vehicle_type_slug: string }[];
}

function mapProduct(row: ProductRow): Product {
  return {
    slug: row.slug,
    name: row.name,
    category: row.category_slug,
    subcategory: row.subcategories?.slug,
    compatibleBrands: row.product_brands.map((pb) => pb.brands.slug),
    vehicleTypes: row.product_vehicle_types.map((pvt) => pvt.vehicle_type_slug),
    images: [...row.product_images]
      .sort((a, b) => a.order - b.order)
      .map((img) => ({ url: img.url, scale: img.scale ?? undefined })),
    shortDescription: row.short_description,
    description: row.description ?? undefined,
    characteristics: row.product_characteristics.length
      ? [...row.product_characteristics]
          .sort((a, b) => a.order - b.order)
          .map(({ attribute, value }) => ({ attribute, value }))
      : undefined,
    article: row.article ?? undefined,
  };
}

interface ProductFilters {
  categorySlug?: string;
  subcategorySlug?: string;
  brandSlug?: string;
  vehicleTypeSlug?: string;
}

export async function getProducts(filters: ProductFilters = {}): Promise<Product[]> {
  const supabase = await createClient();

  // Filtering by brand or vehicle type needs a separate lookup first:
  // PostgREST filters on an embedded one-to-many resource (product_brands /
  // product_vehicle_types) also trim that resource's returned rows to just
  // the match, which would silently drop a product's other compatible
  // brands/vehicle types from the result. Resolving the matching product
  // slugs first keeps the main query's embeds unfiltered/complete — and if
  // both filters are given, intersect instead of letting one overwrite the
  // other (no current caller combines them, but nothing should silently
  // ignore one if that ever changes).
  let bySlugIn: string[] | undefined;

  if (filters.brandSlug) {
    const { data, error } = await supabase
      .from("product_brands")
      .select("products(slug)")
      .eq("brand_slug", filters.brandSlug);
    if (error) throw error;
    const matchingSlugs = (data as unknown as { products: { slug: string } }[]).map((row) => row.products.slug);
    bySlugIn = bySlugIn ? bySlugIn.filter((slug) => matchingSlugs.includes(slug)) : matchingSlugs;
    if (bySlugIn.length === 0) return [];
  }

  if (filters.vehicleTypeSlug) {
    const { data, error } = await supabase
      .from("product_vehicle_types")
      .select("products(slug)")
      .eq("vehicle_type_slug", filters.vehicleTypeSlug);
    if (error) throw error;
    const matchingSlugs = (data as unknown as { products: { slug: string } }[]).map((row) => row.products.slug);
    bySlugIn = bySlugIn ? bySlugIn.filter((slug) => matchingSlugs.includes(slug)) : matchingSlugs;
    if (bySlugIn.length === 0) return [];
  }

  let query = supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .order("order")
    .order("order", { referencedTable: "product_images" })
    .order("order", { referencedTable: "product_characteristics" });

  if (filters.categorySlug) {
    query = query.eq("category_slug", filters.categorySlug);
  }
  if (filters.subcategorySlug) {
    query = query.eq("subcategories.slug", filters.subcategorySlug);
  }
  if (bySlugIn) {
    query = query.in("slug", bySlugIn);
  }

  const { data, error } = await query;
  if (error) throw error;

  // subcategorySlug filters via an embedded relation, which PostgREST can't
  // turn into an inner join through the query builder's typed API here —
  // filter out any row whose joined subcategory doesn't match, rather than
  // relying on eq() above to have excluded them at the database level.
  const rows = (data as unknown as ProductRow[]).filter(
    (row) => !filters.subcategorySlug || row.subcategories?.slug === filters.subcategorySlug
  );

  return rows.map(mapProduct);
}

// Wrapped in cache() so generateMetadata and the page body — which both
// call this with the same slug — share one Supabase request per render
// instead of two.
export const getProduct = cache(async (slug: string): Promise<Product | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("slug", slug)
    .order("order", { referencedTable: "product_images" })
    .order("order", { referencedTable: "product_characteristics" })
    .maybeSingle();
  if (error) throw error;
  return data ? mapProduct(data as unknown as ProductRow) : null;
});
