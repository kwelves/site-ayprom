import { createClient } from "@/lib/supabase/server";
import type { Product } from "@/types/catalog";

const PRODUCT_SELECT = `
  slug, name, category_slug, short_description, description, article,
  subcategories(slug),
  product_images(url, "order"),
  product_characteristics(attribute, value, "order"),
  product_brands(brands(slug, name, country, logo, logo_scale))
`;

interface ProductRow {
  slug: string;
  name: string;
  category_slug: string;
  short_description: string;
  description: string | null;
  article: string | null;
  subcategories: { slug: string } | null;
  product_images: { url: string; order: number }[];
  product_characteristics: { attribute: string; value: string; order: number }[];
  product_brands: { brands: { slug: string } }[];
}

function mapProduct(row: ProductRow): Product {
  return {
    slug: row.slug,
    name: row.name,
    category: row.category_slug,
    subcategory: row.subcategories?.slug,
    compatibleBrands: row.product_brands.map((pb) => pb.brands.slug),
    images: [...row.product_images].sort((a, b) => a.order - b.order).map((img) => img.url),
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
}

export async function getProducts(filters: ProductFilters = {}): Promise<Product[]> {
  const supabase = await createClient();

  // Filtering by brand needs a separate lookup first: PostgREST filters on an
  // embedded one-to-many resource (product_brands) also trim that resource's
  // returned rows to just the match, which would silently drop a product's
  // other compatible brands from the result. Resolving the matching product
  // slugs first keeps the main query's embeds unfiltered/complete.
  let bySlugIn: string[] | undefined;
  if (filters.brandSlug) {
    const { data, error } = await supabase
      .from("product_brands")
      .select("products(slug)")
      .eq("brand_slug", filters.brandSlug);
    if (error) throw error;
    bySlugIn = (data as unknown as { products: { slug: string } }[]).map((row) => row.products.slug);
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

export async function getProduct(slug: string): Promise<Product | null> {
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
}
