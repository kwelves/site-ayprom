import { cache } from "react";
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

// Wrapped in cache() so the per-request duplicate calls dedupe to one Supabase
// round trip: the shared (site) layout fetches categories for Header/Footer nav,
// and the same request's catalog category page fetches them again — two calls
// collapse to one.
export const getCategories = cache(async (): Promise<Category[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("categories").select("*").order("order");
  if (error) throw error;
  return (data as CategoryRow[]).map(mapCategory);
});

// Wrapped in cache() so generateMetadata and the page body — which both
// call this with the same slug — share one Supabase request per render
// instead of two.
export const getCategory = cache(async (slug: string): Promise<Category | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("categories").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data ? mapCategory(data as CategoryRow) : null;
});

// Categories to offer as cards on the brand-first "pick a category" page
// (/catalog/brand/[slug]). The source of truth differs by category type:
// brand-type categories (pto/pto-shafts) are gated by category_brands —
// the same table /catalog/category/[slug]/brand/[brandSlug] itself requires
// a match in, so a card never links to a 404. Subcategory-type categories
// have no such gating table, so real products are the only signal.
export async function getBrandCategories(brandSlug: string): Promise<Category[]> {
  const supabase = await createClient();

  const { data: allCategories, error: categoriesError } = await supabase.from("categories").select("*").order("order");
  if (categoriesError) throw categoriesError;
  const rows = allCategories as CategoryRow[];

  const brandTypeSlugs = rows.filter((row) => row.type === "brand").map((row) => row.slug);
  const subcategoryTypeSlugs = new Set(rows.filter((row) => row.type === "subcategory").map((row) => row.slug));

  const [categoryBrandsResult, productBrandsResult] = await Promise.all([
    brandTypeSlugs.length > 0
      ? supabase
          .from("category_brands")
          .select("category_slug")
          .eq("brand_slug", brandSlug)
          .in("category_slug", brandTypeSlugs)
      : null,
    subcategoryTypeSlugs.size > 0
      ? supabase.from("product_brands").select("products(category_slug)").eq("brand_slug", brandSlug)
      : null,
  ]);

  const matchedSlugs = new Set<string>();

  if (categoryBrandsResult) {
    if (categoryBrandsResult.error) throw categoryBrandsResult.error;
    for (const row of categoryBrandsResult.data as { category_slug: string }[]) {
      matchedSlugs.add(row.category_slug);
    }
  }
  if (productBrandsResult) {
    if (productBrandsResult.error) throw productBrandsResult.error;
    for (const row of productBrandsResult.data as unknown as { products: { category_slug: string } }[]) {
      if (subcategoryTypeSlugs.has(row.products.category_slug)) {
        matchedSlugs.add(row.products.category_slug);
      }
    }
  }

  return rows.filter((row) => matchedSlugs.has(row.slug)).map(mapCategory);
}
