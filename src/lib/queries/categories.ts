import { createClient } from "@/lib/supabase/server";
import type { Category } from "@/types/catalog";

interface CategoryRow {
  slug: string;
  name: string;
  description: string;
  icon: string;
  image: string;
  intro: string | null;
  type: "subcategory" | "brand";
}

function mapCategory(row: CategoryRow): Category {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon as Category["icon"],
    image: row.image,
    intro: row.intro ?? undefined,
    type: row.type,
  };
}

export async function getCategories(): Promise<Category[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("categories").select("*").order("order");
  if (error) throw error;
  return (data as CategoryRow[]).map(mapCategory);
}

export async function getCategory(slug: string): Promise<Category | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("categories").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data ? mapCategory(data as CategoryRow) : null;
}
