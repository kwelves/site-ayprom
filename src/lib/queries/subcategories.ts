import { createClient } from "@/lib/supabase/server";
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
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subcategories")
    .select("slug, name, image, intro")
    .eq("category_slug", categorySlug)
    .order("order");
  if (error) throw error;
  return (data as SubcategoryRow[]).map(mapSubcategory);
}

export async function getSubcategory(categorySlug: string, subSlug: string): Promise<Subcategory | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subcategories")
    .select("slug, name, image, intro")
    .eq("category_slug", categorySlug)
    .eq("slug", subSlug)
    .maybeSingle();
  if (error) throw error;
  return data ? mapSubcategory(data as SubcategoryRow) : null;
}

// Every subcategory across every category at once, with its parent category
// slug attached — used by search-products.ts to build search text for a
// batch of products without a query per product.
export async function getAllSubcategories(): Promise<(Subcategory & { categorySlug: string })[]> {
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
