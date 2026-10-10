import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { activeCatalogReaderIfEnabled, catalogCompositeKey } from "@/lib/catalog-publication-reader";
import type { Subcategory } from "@/types/catalog";

interface SubcategoryRow {
  slug: string;
  name: string;
  image: string;
  intro: string | null;
}

function mapSubcategory(row: SubcategoryRow): Subcategory {
  return {
    slug: row.slug,
    name: row.name,
    image: row.image,
    intro: row.intro ?? undefined,
  };
}

export async function getSubcategories(categorySlug: string): Promise<Subcategory[]> {
  const reader = await activeCatalogReaderIfEnabled();
  if (reader) return (await reader.list<SubcategoryRow & { category_slug: string; order: number }>("subcategory"))
    .filter((row) => row.category_slug === categorySlug).sort((a, b) => a.order - b.order).map(mapSubcategory);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subcategories")
    .select("slug, name, image, intro")
    .eq("category_slug", categorySlug)
    .order("order");
  if (error) throw error;
  return (data as SubcategoryRow[]).map(mapSubcategory);
}

// Wrapped in cache() so generateMetadata and the page body — which both
// call this with the same slugs — share one Supabase request per render
// instead of two.
export const getSubcategory = cache(async (categorySlug: string, subSlug: string): Promise<Subcategory | null> => {
  const reader = await activeCatalogReaderIfEnabled();
  if (reader) {
    const row = await reader.get<SubcategoryRow>("subcategory", catalogCompositeKey(categorySlug, subSlug));
    return row ? mapSubcategory(row) : null;
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subcategories")
    .select("slug, name, image, intro")
    .eq("category_slug", categorySlug)
    .eq("slug", subSlug)
    .maybeSingle();
  if (error) throw error;
  return data ? mapSubcategory(data as SubcategoryRow) : null;
});

// Subcategories to offer as cards on the brand-first "pick a subcategory"
// page (/catalog/brand/[slug]/category/[categorySlug]) — no gating table
// exists for this combination, so a brand having a real product in that
// (category, subcategory) pair is the only signal.
export async function getBrandSubcategories(brandSlug: string, categorySlug: string): Promise<Subcategory[]> {
  const reader = await activeCatalogReaderIfEnabled();
  if (reader) {
    const [subcategories, products] = await Promise.all([
      reader.list<SubcategoryRow & { category_slug: string; order: number }>("subcategory"),
      reader.list<{ category_slug: string; subcategories: { slug: string } | null; product_brands: { brands: { slug: string } }[] }>("product"),
    ]);
    const matched = new Set(products.filter((product) => product.category_slug === categorySlug
      && product.product_brands.some((brand) => brand.brands.slug === brandSlug))
      .map((product) => product.subcategories?.slug).filter((slug): slug is string => !!slug));
    return subcategories.filter((row) => row.category_slug === categorySlug && matched.has(row.slug))
      .sort((a, b) => a.order - b.order).map(mapSubcategory);
  }
  const supabase = await createClient();

  const { data: productBrands, error: pbError } = await supabase
    .from("product_brands")
    .select("products(category_slug, subcategory_id)")
    .eq("brand_slug", brandSlug);
  if (pbError) throw pbError;

  const subcategoryIds = new Set<string>();
  for (const row of productBrands as unknown as {
    products: { category_slug: string; subcategory_id: string | null };
  }[]) {
    if (row.products.category_slug === categorySlug && row.products.subcategory_id) {
      subcategoryIds.add(row.products.subcategory_id);
    }
  }
  if (subcategoryIds.size === 0) return [];

  const { data, error } = await supabase
    .from("subcategories")
    .select("slug, name, image, intro")
    .in("id", [...subcategoryIds])
    .order("order");
  if (error) throw error;
  return (data as SubcategoryRow[]).map(mapSubcategory);
}

// Every subcategory across every category at once, with its parent category
// slug attached — the product form needs the full list to populate its
// category-dependent subcategory select, and the sitemap needs it to emit
// every subcategory URL.
export async function getAllSubcategories(): Promise<(Subcategory & { categorySlug: string })[]> {
  const reader = await activeCatalogReaderIfEnabled();
  if (reader) return (await reader.list<SubcategoryRow & { category_slug: string; order: number }>("subcategory"))
    .sort((a, b) => a.order - b.order).map((row) => ({ ...mapSubcategory(row), categorySlug: row.category_slug }));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subcategories")
    .select("slug, name, image, intro, category_slug")
    .order("order");
  if (error) throw error;
  return (data as (SubcategoryRow & { category_slug: string })[]).map((row) => ({
    ...mapSubcategory(row),
    categorySlug: row.category_slug,
  }));
}
