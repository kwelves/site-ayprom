import { createClient } from "@/lib/supabase/server";
import { activeCatalogReaderIfEnabled } from "@/lib/catalog-publication-reader";
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
  const reader = await activeCatalogReaderIfEnabled();
  if (reader) {
    const [links, brands] = await Promise.all([
      reader.list<{ category_slug: string; brand_slug: string; logo_scale_override: number | null; order: number }>("category_brand"),
      reader.list<CategoryBrandRow["brands"]>("brand"),
    ]);
    const bySlug = new Map(brands.map((brand) => [brand.slug, brand]));
    return links.filter((link) => link.category_slug === categorySlug).sort((a, b) => a.order - b.order)
      .map((link) => {
        const brand = bySlug.get(link.brand_slug);
        if (!brand) throw new Error("Catalog publication unavailable");
        return { slug: brand.slug, name: brand.name, country: brand.country, logo: brand.logo,
          logoScale: link.logo_scale_override ?? brand.logo_scale ?? undefined };
      });
  }
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
  const reader = await activeCatalogReaderIfEnabled();
  if (reader) {
    const links = await reader.list<{ category_slug: string; brand_slug: string }>("category_brand");
    const map: Record<string, string[]> = {};
    for (const link of links) (map[link.category_slug] ??= []).push(link.brand_slug);
    return map;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("category_brands").select("category_slug, brand_slug");
  if (error) throw error;

  const map: Record<string, string[]> = {};
  for (const row of data as { category_slug: string; brand_slug: string }[]) {
    (map[row.category_slug] ??= []).push(row.brand_slug);
  }
  return map;
}
