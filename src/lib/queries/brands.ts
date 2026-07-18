import { createClient } from "@/lib/supabase/server";
import type { Brand } from "@/types/catalog";

interface BrandRow {
  slug: string;
  name: string;
  country: string;
  logo: string;
  logo_scale: number | null;
  relation: "for" | "from";
}

function mapBrand(row: BrandRow): Brand {
  return {
    slug: row.slug,
    name: row.name,
    country: row.country,
    logo: row.logo,
    logoScale: row.logo_scale ?? undefined,
    relation: row.relation,
  };
}

export async function getBrands(): Promise<Brand[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("brands").select("*").order("order");
  if (error) throw error;
  return (data as BrandRow[]).map(mapBrand);
}

export async function getBrand(slug: string): Promise<Brand | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("brands").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data ? mapBrand(data as BrandRow) : null;
}
