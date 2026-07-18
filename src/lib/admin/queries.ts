import { createAdminClient } from "@/lib/supabase/admin";

export interface AdminProductListItem {
  id: string;
  slug: string;
  name: string;
  categoryName: string;
  published: boolean;
  order: number;
  coverImage: string | null;
}

interface AdminProductListRow {
  id: string;
  slug: string;
  name: string;
  published: boolean;
  order: number;
  categories: { name: string } | null;
  product_images: { url: string; order: number }[];
}

// Every product regardless of `published` status — unlike the public
// getProducts(), this reads via the service-role client so drafts are
// visible to the admin.
export async function getAdminProducts(): Promise<AdminProductListItem[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, slug, name, published, order, categories(name), product_images(url, order)")
    .order("order");
  if (error) throw error;

  return (data as unknown as AdminProductListRow[]).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    categoryName: row.categories?.name ?? "—",
    published: row.published,
    order: row.order,
    coverImage: [...row.product_images].sort((a, b) => a.order - b.order)[0]?.url ?? null,
  }));
}

export interface AdminProduct {
  id: string;
  slug: string;
  name: string;
  category: string;
  subcategory?: string;
  shortDescription: string;
  description?: string;
  article?: string;
  published: boolean;
  compatibleBrands: string[];
  images: { id: string; url: string; order: number }[];
  characteristics: { id: string; attribute: string; value: string; order: number }[];
}

const ADMIN_PRODUCT_SELECT = `
  id, slug, name, category_slug, short_description, description, article, published,
  subcategories(slug),
  product_images(id, url, "order"),
  product_characteristics(id, attribute, value, "order"),
  product_brands(brand_slug)
`;

interface AdminProductRow {
  id: string;
  slug: string;
  name: string;
  category_slug: string;
  short_description: string;
  description: string | null;
  article: string | null;
  published: boolean;
  subcategories: { slug: string } | null;
  product_images: { id: string; url: string; order: number }[];
  product_characteristics: { id: string; attribute: string; value: string; order: number }[];
  product_brands: { brand_slug: string }[];
}

// Full detail for the edit form — same nested shape as the public
// getProduct(), plus row ids (needed for image/characteristic mutations)
// and `published`, and no RLS visibility filter (service-role client).
export async function getAdminProduct(slug: string): Promise<AdminProduct | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("products")
    .select(ADMIN_PRODUCT_SELECT)
    .eq("slug", slug)
    .order("order", { referencedTable: "product_images" })
    .order("order", { referencedTable: "product_characteristics" })
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as AdminProductRow;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category_slug,
    subcategory: row.subcategories?.slug,
    shortDescription: row.short_description,
    description: row.description ?? undefined,
    article: row.article ?? undefined,
    published: row.published,
    compatibleBrands: row.product_brands.map((pb) => pb.brand_slug),
    images: [...row.product_images].sort((a, b) => a.order - b.order),
    characteristics: [...row.product_characteristics].sort((a, b) => a.order - b.order),
  };
}

export interface AdminBrand {
  slug: string;
  name: string;
  country: string;
  logo: string;
  logoScale?: number;
  relation: "for" | "from";
  order: number;
  /** How many products/brand-type categories reference this brand — shown
   * as a delete-confirmation warning, since removing a widely-used brand
   * silently cascades those associations away. */
  productCount: number;
  categoryCount: number;
}

interface BrandRow {
  slug: string;
  name: string;
  country: string;
  logo: string;
  logo_scale: number | null;
  relation: "for" | "from";
  order: number;
}

async function getBrandUsageCounts(
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ productCounts: Map<string, number>; categoryCounts: Map<string, number> }> {
  const [{ data: productBrands, error: pbError }, { data: categoryBrands, error: cbError }] = await Promise.all([
    supabase.from("product_brands").select("brand_slug"),
    supabase.from("category_brands").select("brand_slug"),
  ]);
  if (pbError) throw pbError;
  if (cbError) throw cbError;

  const productCounts = new Map<string, number>();
  for (const row of productBrands as { brand_slug: string }[]) {
    productCounts.set(row.brand_slug, (productCounts.get(row.brand_slug) ?? 0) + 1);
  }
  const categoryCounts = new Map<string, number>();
  for (const row of categoryBrands as { brand_slug: string }[]) {
    categoryCounts.set(row.brand_slug, (categoryCounts.get(row.brand_slug) ?? 0) + 1);
  }
  return { productCounts, categoryCounts };
}

function mapBrand(
  row: BrandRow,
  productCounts: Map<string, number>,
  categoryCounts: Map<string, number>
): AdminBrand {
  return {
    slug: row.slug,
    name: row.name,
    country: row.country,
    logo: row.logo,
    logoScale: row.logo_scale ?? undefined,
    relation: row.relation,
    order: row.order,
    productCount: productCounts.get(row.slug) ?? 0,
    categoryCount: categoryCounts.get(row.slug) ?? 0,
  };
}

export async function getAdminBrands(): Promise<AdminBrand[]> {
  const supabase = createAdminClient();
  const [{ data, error }, { productCounts, categoryCounts }] = await Promise.all([
    supabase.from("brands").select("*").order("order"),
    getBrandUsageCounts(supabase),
  ]);
  if (error) throw error;

  return (data as BrandRow[]).map((row) => mapBrand(row, productCounts, categoryCounts));
}

// Shared by BrandsList and BrandForm's delete buttons — deleting a brand
// cascades away its product_brands/category_brands rows silently, so both
// confirmation dialogs need to say what's actually at stake.
export function describeBrandUsage(brand: AdminBrand): string {
  const parts: string[] = [];
  if (brand.productCount > 0) parts.push(`${brand.productCount} товар(ах)`);
  if (brand.categoryCount > 0) parts.push(`${brand.categoryCount} категории(ях)`);
  return parts.length > 0 ? ` Бренд используется в ${parts.join(" и ")} — эти связи тоже исчезнут.` : "";
}

export async function getAdminBrand(slug: string): Promise<AdminBrand | null> {
  const supabase = createAdminClient();
  const [{ data, error }, { productCounts, categoryCounts }] = await Promise.all([
    supabase.from("brands").select("*").eq("slug", slug).maybeSingle(),
    getBrandUsageCounts(supabase),
  ]);
  if (error) throw error;
  return data ? mapBrand(data as BrandRow, productCounts, categoryCounts) : null;
}
