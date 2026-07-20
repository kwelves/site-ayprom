import { createAdminClient } from "@/lib/supabase/admin";
import type { CategoryIcon } from "@/types/catalog";

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

export interface AdminProductFilters {
  q?: string;
  categorySlug?: string;
}

// Every product regardless of `published` status — unlike the public
// getProducts(), this reads via the service-role client so drafts are
// visible to the admin.
export async function getAdminProducts(filters: AdminProductFilters = {}): Promise<AdminProductListItem[]> {
  const supabase = createAdminClient();
  let query = supabase
    .from("products")
    .select("id, slug, name, published, order, categories(name), product_images(url, order)")
    .order("order");

  if (filters.categorySlug) {
    query = query.eq("category_slug", filters.categorySlug);
  }
  if (filters.q?.trim()) {
    // PostgREST's or() parses commas/parens as filter syntax — strip them so a
    // search term can't break out of the ilike pair or inject extra filters.
    const term = filters.q.trim().replace(/[%,()]/g, "");
    if (term) {
      query = query.or(`name.ilike.%${term}%,article.ilike.%${term}%`);
    }
  }

  const { data, error } = await query;
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
  vehicleTypes: string[];
  images: { id: string; url: string; order: number }[];
  characteristics: { id: string; attribute: string; value: string; order: number }[];
}

const ADMIN_PRODUCT_SELECT = `
  id, slug, name, category_slug, short_description, description, article, published,
  subcategories(slug),
  product_images(id, url, "order"),
  product_characteristics(id, attribute, value, "order"),
  product_brands(brand_slug),
  product_vehicle_types(vehicle_type_slug)
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
  product_vehicle_types: { vehicle_type_slug: string }[];
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
    vehicleTypes: row.product_vehicle_types.map((pvt) => pvt.vehicle_type_slug),
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

export interface AdminCategory {
  slug: string;
  name: string;
  description: string;
  icon: CategoryIcon;
  image: string;
  intro?: string;
  type: "subcategory" | "brand";
  order: number;
  subcategoryCount: number;
  categoryBrandCount: number;
  productCount: number;
}

interface CategoryRow {
  slug: string;
  name: string;
  description: string;
  icon: string;
  image: string;
  intro: string | null;
  type: "subcategory" | "brand";
  order: number;
}

// categorySlug narrows all three scans to one category — used by
// getAdminCategory, which otherwise paid for 3 full-table scans just to
// count usage for a single row (getAdminCategories legitimately needs the
// unfiltered counts, since it computes them for every category at once).
async function getCategoryUsageCounts(
  supabase: ReturnType<typeof createAdminClient>,
  categorySlug?: string
): Promise<{
  subcategoryCounts: Map<string, number>;
  categoryBrandCounts: Map<string, number>;
  productCounts: Map<string, number>;
}> {
  let subQuery = supabase.from("subcategories").select("category_slug");
  let cbQuery = supabase.from("category_brands").select("category_slug");
  let prodQuery = supabase.from("products").select("category_slug");
  if (categorySlug) {
    subQuery = subQuery.eq("category_slug", categorySlug);
    cbQuery = cbQuery.eq("category_slug", categorySlug);
    prodQuery = prodQuery.eq("category_slug", categorySlug);
  }

  const [
    { data: subcategories, error: subError },
    { data: categoryBrands, error: cbError },
    { data: products, error: prodError },
  ] = await Promise.all([subQuery, cbQuery, prodQuery]);
  if (subError) throw subError;
  if (cbError) throw cbError;
  if (prodError) throw prodError;

  const subcategoryCounts = new Map<string, number>();
  for (const row of subcategories as { category_slug: string }[]) {
    subcategoryCounts.set(row.category_slug, (subcategoryCounts.get(row.category_slug) ?? 0) + 1);
  }
  const categoryBrandCounts = new Map<string, number>();
  for (const row of categoryBrands as { category_slug: string }[]) {
    categoryBrandCounts.set(row.category_slug, (categoryBrandCounts.get(row.category_slug) ?? 0) + 1);
  }
  const productCounts = new Map<string, number>();
  for (const row of products as { category_slug: string }[]) {
    productCounts.set(row.category_slug, (productCounts.get(row.category_slug) ?? 0) + 1);
  }
  return { subcategoryCounts, categoryBrandCounts, productCounts };
}

function mapCategory(
  row: CategoryRow,
  counts: Awaited<ReturnType<typeof getCategoryUsageCounts>>
): AdminCategory {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon as CategoryIcon,
    image: row.image,
    intro: row.intro ?? undefined,
    type: row.type,
    order: row.order,
    subcategoryCount: counts.subcategoryCounts.get(row.slug) ?? 0,
    categoryBrandCount: counts.categoryBrandCounts.get(row.slug) ?? 0,
    productCount: counts.productCounts.get(row.slug) ?? 0,
  };
}

export async function getAdminCategories(): Promise<AdminCategory[]> {
  const supabase = createAdminClient();
  const [{ data, error }, counts] = await Promise.all([
    supabase.from("categories").select("*").order("order"),
    getCategoryUsageCounts(supabase),
  ]);
  if (error) throw error;
  return (data as CategoryRow[]).map((row) => mapCategory(row, counts));
}

export async function getAdminCategory(slug: string): Promise<AdminCategory | null> {
  const supabase = createAdminClient();
  const [{ data, error }, counts] = await Promise.all([
    supabase.from("categories").select("*").eq("slug", slug).maybeSingle(),
    getCategoryUsageCounts(supabase, slug),
  ]);
  if (error) throw error;
  return data ? mapCategory(data as CategoryRow, counts) : null;
}

// Shared by CategoriesList and CategoryForm's delete buttons. Products are
// deliberately not mentioned here — the DB's FK on products.category_slug
// has no cascade, so deleting a category with products fails outright
// rather than silently orphaning them; the caller checks productCount
// separately to block the attempt before it hits that error.
export function describeCategoryUsage(category: AdminCategory): string {
  const parts: string[] = [];
  if (category.subcategoryCount > 0) parts.push(`${category.subcategoryCount} подкатегори(ях)`);
  if (category.categoryBrandCount > 0) parts.push(`${category.categoryBrandCount} привязанных бренд(ах)`);
  return parts.length > 0 ? ` В категории есть ${parts.join(" и ")} — они тоже удалятся.` : "";
}

export interface AdminSubcategory {
  id: string;
  slug: string;
  name: string;
  image: string;
  intro?: string;
  order: number;
  productCount: number;
}

interface SubcategoryRow {
  id: string;
  slug: string;
  name: string;
  image: string;
  intro: string | null;
  order: number;
}

export async function getAdminSubcategories(categorySlug: string): Promise<AdminSubcategory[]> {
  const supabase = createAdminClient();
  const [{ data, error }, { data: products, error: prodError }] = await Promise.all([
    supabase.from("subcategories").select("*").eq("category_slug", categorySlug).order("order"),
    supabase.from("products").select("subcategory_id").eq("category_slug", categorySlug),
  ]);
  if (error) throw error;
  if (prodError) throw prodError;

  const productCounts = new Map<string, number>();
  for (const row of products as { subcategory_id: string | null }[]) {
    if (!row.subcategory_id) continue;
    productCounts.set(row.subcategory_id, (productCounts.get(row.subcategory_id) ?? 0) + 1);
  }

  return (data as SubcategoryRow[]).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    image: row.image,
    intro: row.intro ?? undefined,
    order: row.order,
    productCount: productCounts.get(row.id) ?? 0,
  }));
}

// No dedicated single-row query — categories only ever have a handful of
// subcategories, so reusing the list call and finding by slug avoids a
// second near-identical query for what's a rare cache miss at this scale.
export async function getAdminSubcategory(categorySlug: string, subSlug: string): Promise<AdminSubcategory | null> {
  const subcategories = await getAdminSubcategories(categorySlug);
  return subcategories.find((sub) => sub.slug === subSlug) ?? null;
}

export interface AdminCategoryBrand {
  brandSlug: string;
  brandName: string;
  brandLogo: string;
  logoScaleOverride?: number;
  order: number;
}

interface CategoryBrandRow {
  brand_slug: string;
  logo_scale_override: number | null;
  order: number;
  brands: { name: string; logo: string };
}

export async function getAdminCategoryBrands(categorySlug: string): Promise<AdminCategoryBrand[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("category_brands")
    .select("brand_slug, logo_scale_override, order, brands(name, logo)")
    .eq("category_slug", categorySlug)
    .order("order");
  if (error) throw error;

  return (data as unknown as CategoryBrandRow[]).map((row) => ({
    brandSlug: row.brand_slug,
    brandName: row.brands.name,
    brandLogo: row.brands.logo,
    logoScaleOverride: row.logo_scale_override ?? undefined,
    order: row.order,
  }));
}

export interface AdminVehicleType {
  slug: string;
  name: string;
  order: number;
  /** How many products reference this vehicle type — shown as a
   * delete-confirmation warning, same reasoning as AdminBrand.productCount. */
  productCount: number;
}

interface VehicleTypeRow {
  slug: string;
  name: string;
  order: number;
}

async function getVehicleTypeUsageCounts(
  supabase: ReturnType<typeof createAdminClient>
): Promise<Map<string, number>> {
  const { data, error } = await supabase.from("product_vehicle_types").select("vehicle_type_slug");
  if (error) throw error;

  const productCounts = new Map<string, number>();
  for (const row of data as { vehicle_type_slug: string }[]) {
    productCounts.set(row.vehicle_type_slug, (productCounts.get(row.vehicle_type_slug) ?? 0) + 1);
  }
  return productCounts;
}

function mapVehicleType(row: VehicleTypeRow, productCounts: Map<string, number>): AdminVehicleType {
  return {
    slug: row.slug,
    name: row.name,
    order: row.order,
    productCount: productCounts.get(row.slug) ?? 0,
  };
}

export async function getAdminVehicleTypes(): Promise<AdminVehicleType[]> {
  const supabase = createAdminClient();
  const [{ data, error }, productCounts] = await Promise.all([
    supabase.from("vehicle_types").select("*").order("order"),
    getVehicleTypeUsageCounts(supabase),
  ]);
  if (error) throw error;

  return (data as VehicleTypeRow[]).map((row) => mapVehicleType(row, productCounts));
}

// Shared by VehicleTypesList and VehicleTypeForm's delete buttons — same
// reasoning as describeBrandUsage.
export function describeVehicleTypeUsage(vehicleType: AdminVehicleType): string {
  return vehicleType.productCount > 0
    ? ` Тип используется в ${vehicleType.productCount} товар(ах) — эта связь тоже исчезнет.`
    : "";
}

export async function getAdminVehicleType(slug: string): Promise<AdminVehicleType | null> {
  const supabase = createAdminClient();
  const [{ data, error }, productCounts] = await Promise.all([
    supabase.from("vehicle_types").select("*").eq("slug", slug).maybeSingle(),
    getVehicleTypeUsageCounts(supabase),
  ]);
  if (error) throw error;
  return data ? mapVehicleType(data as VehicleTypeRow, productCounts) : null;
}
