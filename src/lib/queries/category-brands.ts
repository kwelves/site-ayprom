import { createClient } from "@/lib/supabase/server";
import type { Brand } from "@/types/catalog";

interface CategoryBrandRow {
  logo_scale_override: number | null;
  brands: {
    slug: string;
    name: string;
    country: string;
    logo: string;
    logo_scale: number | null;
  };
}

// Brands attached to a brand-type category (pto/pto-shafts) — logo_scale_override
// (tuned for this page's bigger card frame) wins over the brand's own default
// logoScale (tuned for the smaller homepage badge) when present.
export async function getCategoryBrands(categorySlug: string): Promise<Brand[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("category_brands")
    .select("logo_scale_override, brands(*)")
    .eq("category_slug", categorySlug)
    .order("order");
  if (error) throw error;

  return (data as unknown as CategoryBrandRow[]).map((row) => ({
    slug: row.brands.slug,
    name: row.brands.name,
    country: row.brands.country,
    logo: row.brands.logo,
    logoScale: row.logo_scale_override ?? row.brands.logo_scale ?? undefined,
  }));
}

// category slug -> its valid brand slugs, for every brand-type category at
// once — used by getProductHref so callers looping over many products don't
// need a query per product. Small table (currently 18 rows total).
export async function getCategoryBrandSlugs(): Promise<Record<string, string[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("category_brands").select("category_slug, brand_slug");
  if (error) throw error;

  const map: Record<string, string[]> = {};
  for (const row of data as { category_slug: string; brand_slug: string }[]) {
    (map[row.category_slug] ??= []).push(row.brand_slug);
  }
  return map;
}
