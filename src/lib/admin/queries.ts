// Server-only: every function here reads through the service-role client.
// The delete-confirmation wording that Client Components need lives in
// src/lib/admin/usage-descriptions.ts, so importing it can't pull this
// module (and the service-role client with it) into the client bundle.
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { ADMIN_PAGE_SIZE } from "@/lib/admin/pagination";
import type { CategoryIcon } from "@/types/catalog";
import type { ProductAvailability } from "@/lib/admin/product-availability";

export interface AdminProductListItem {
  id: string;
  slug: string;
  name: string;
  categoryName: string;
  article?: string;
  shortDescription: string;
  published: boolean;
  availability: ProductAvailability;
  /** Current number of Special equipment hotspots pinned to this product.
   * The list uses it to require an explicit confirmation before an
   * unpublish operation triggers automatic detachment. */
  hotspotCount: number;
  order: number;
  updatedAt: string;
  coverImage: string | null;
}

interface AdminProductListRow {
  id: string;
  slug: string;
  name: string;
  article: string | null;
  short_description: string;
  published: boolean;
  availability: ProductAvailability;
  order: number;
  updated_at: string;
  categories: { name: string } | null;
  product_images: { url: string; order: number }[];
  vehicle_hotspots: { id: string }[];
}

export interface AuditLogEntry {
  id: number;
  occurredAt: string;
  actor: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  entityType: string;
  entityKey: string | null;
  changedFields: string[];
  /** Field values before the change — null for rows written before the
   * before/after migration, or when the change had nothing to record
   * (e.g. a DELETE's oldValues always has content, but INSERT's is always
   * null since there was no prior row). */
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AuditLogFilters {
  entityType?: string;
  action?: string;
  page?: number;
  pageSize?: number;
}

// Журнал изменений пишется триггерами базы, а не приложением — здесь только
// чтение. Пагинация обязательна: массовый импорт порождает записи на каждую
// строку каждой связанной таблицы, и таблица растёт быстрее самого каталога
// (нагрузочный прогон на 5000 товаров дал 144 тысячи записей).
export async function getAuditLog(filters: AuditLogFilters = {}): Promise<AuditLogPage> {
  const supabase = createAdminClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? ADMIN_PAGE_SIZE));
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("admin_audit_log")
    .select("id, occurred_at, actor, action, entity_type, entity_key, changed_fields, old_values, new_values", { count: "exact" })
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + pageSize - 1);

  if (filters.entityType) query = query.eq("entity_type", filters.entityType);
  if (filters.action) query = query.eq("action", filters.action);

  const { data, error, count } = await query;
  if (error) throw error;

  const total = count ?? 0;
  return {
    items: (data ?? []).map((row) => ({
      id: row.id as number,
      occurredAt: row.occurred_at as string,
      actor: row.actor as string,
      action: row.action as AuditLogEntry["action"],
      entityType: row.entity_type as string,
      entityKey: (row.entity_key as string | null) ?? null,
      changedFields: (row.changed_fields as string[] | null) ?? [],
      oldValues: (row.old_values as Record<string, unknown> | null) ?? null,
      newValues: (row.new_values as Record<string, unknown> | null) ?? null,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// Значения для выпадающих фильтров берутся из самих данных, а не
// хардкодятся: набор таблиц под аудитом задан триггерами в миграции и может
// измениться независимо от этого кода.
export async function getAuditLogEntityTypes(): Promise<string[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("admin_audit_log").select("entity_type").limit(1000);
  if (error) throw error;
  return [...new Set((data ?? []).map((row) => row.entity_type as string))].sort();
}

export type AdminProductSort = "order" | "name" | "updated";

export interface AdminProductFilters {
  q?: string;
  categorySlug?: string;
  published?: boolean;
  availability?: ProductAvailability;
  sort?: AdminProductSort;
  page?: number;
  pageSize?: number;
}

export interface AdminProductPage {
  items: AdminProductListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Every product regardless of `published` status — unlike the public
// getProducts(), this reads via the service-role client so drafts are
// visible to the admin.
//
// Пагинация обязательна, а не удобство: config.toml ограничивает ответ
// PostgREST тысячей строк (max_rows), поэтому прежний запрос без range()
// при каталоге в 2000 товаров молча показывал бы половину — без ошибки и
// без единого признака, что список неполон.
export async function getAdminProducts(filters: AdminProductFilters = {}): Promise<AdminProductPage> {
  const supabase = createAdminClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? ADMIN_PAGE_SIZE));
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("products")
    .select(
      "id, slug, name, article, short_description, published, availability, order, updated_at, categories(name), product_images(url, order), vehicle_hotspots(id)",
      { count: "exact" },
    )
    .range(from, from + pageSize - 1);

  // Ручной порядок (drag-n-drop) осмыслен только для sort==="order" — иначе
  // reorder_products переставлял бы товары внутри значений order, которые
  // сейчас не определяют видимый порядок списка.
  if (filters.sort === "name") {
    query = query.order("name");
  } else if (filters.sort === "updated") {
    query = query.order("updated_at", { ascending: false });
  } else {
    query = query.order("order");
  }

  if (filters.categorySlug) {
    query = query.eq("category_slug", filters.categorySlug);
  }
  if (filters.published !== undefined) {
    query = query.eq("published", filters.published);
  }
  if (filters.availability) {
    query = query.eq("availability", filters.availability);
  }
  if (filters.q?.trim()) {
    // PostgREST's or() parses commas/parens as filter syntax — strip them so a
    // search term can't break out of the ilike pair or inject extra filters.
    const term = filters.q.trim().replace(/[%,()]/g, "");
    if (term) {
      query = query.or(`name.ilike.%${term}%,article.ilike.%${term}%`);
    }
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const total = count ?? 0;
  return {
    items: (data as unknown as AdminProductListRow[]).map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      article: row.article ?? undefined,
      shortDescription: row.short_description,
      categoryName: row.categories?.name ?? "—",
      published: row.published,
      availability: row.availability,
      hotspotCount: row.vehicle_hotspots?.length ?? 0,
      order: row.order,
      updatedAt: row.updated_at,
      coverImage: [...row.product_images].sort((a, b) => a.order - b.order)[0]?.url ?? null,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
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
  availability: ProductAvailability;
  metaTitle?: string;
  metaDescription?: string;
  compatibleBrands: string[];
  vehicleTypes: string[];
  images: { id: string; url: string; order: number; scale: number | null }[];
  characteristics: { id: string; attribute: string; value: string; order: number }[];
  /** Number of Special equipment hotspots currently showing this product.
   * The product form uses it to warn before an unpublish operation clears
   * those assignments in the database. */
  hotspotCount: number;
}

const ADMIN_PRODUCT_SELECT = `
  id, slug, name, category_slug, short_description, description, article, published,
  availability, meta_title, meta_description,
  subcategories(slug),
  product_images(id, url, "order", scale),
  product_characteristics(id, attribute, value, "order"),
  product_brands(brand_slug),
  product_vehicle_types(vehicle_type_slug),
  vehicle_hotspots(id)
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
  availability: ProductAvailability;
  meta_title: string | null;
  meta_description: string | null;
  subcategories: { slug: string } | null;
  product_images: { id: string; url: string; order: number; scale: number | null }[];
  product_characteristics: { id: string; attribute: string; value: string; order: number }[];
  product_brands: { brand_slug: string }[];
  product_vehicle_types: { vehicle_type_slug: string }[];
  vehicle_hotspots: { id: string }[];
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
    availability: row.availability,
    metaTitle: row.meta_title ?? undefined,
    metaDescription: row.meta_description ?? undefined,
    compatibleBrands: row.product_brands.map((pb) => pb.brand_slug),
    vehicleTypes: row.product_vehicle_types.map((pvt) => pvt.vehicle_type_slug),
    images: [...row.product_images].sort((a, b) => a.order - b.order),
    characteristics: [...row.product_characteristics].sort((a, b) => a.order - b.order),
    hotspotCount: row.vehicle_hotspots?.length ?? 0,
  };
}

export interface AdminAvailableProduct {
  id: string;
  slug: string;
  name: string;
  article?: string;
}

export interface AdminVehicleHotspot {
  id: string;
  vehicleTypeSlug: string;
  hotspotNumber: number;
  label: string;
  /** Read-only reference coordinates (percent of the source photo) — for
   * rendering VehicleHotspotPreview only. Position and numbering are still
   * authored exclusively in migrations; nothing in this admin surface writes
   * these two fields back. */
  xPct: number;
  yPct: number;
  product: AdminAvailableProduct | null;
}

interface AdminVehicleHotspotRow {
  id: string;
  vehicle_type_slug: string;
  hotspot_number: number;
  label: string;
  x_pct: number;
  y_pct: number;
  products: {
    id: string;
    slug: string;
    name: string;
    article: string | null;
  } | null;
}

// The geometry and numbering of these rows are authored in migrations and
// deliberately not editable from this admin surface — x_pct/y_pct are read
// here only so VehicleHotspotPreview can show admins where each point
// actually sits; the editor form below it still only writes label/product.
export async function getAdminVehicleHotspots(vehicleTypeSlug: string): Promise<AdminVehicleHotspot[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("vehicle_hotspots")
    .select("id, vehicle_type_slug, hotspot_number, label, x_pct, y_pct, products(id, slug, name, article)")
    .eq("vehicle_type_slug", vehicleTypeSlug)
    .order("hotspot_number");
  if (error) throw error;

  return (data as unknown as AdminVehicleHotspotRow[]).map((row) => ({
    id: row.id,
    vehicleTypeSlug: row.vehicle_type_slug,
    hotspotNumber: row.hotspot_number,
    label: row.label,
    xPct: row.x_pct,
    yPct: row.y_pct,
    product: row.products
      ? {
          id: row.products.id,
          slug: row.products.slug,
          name: row.products.name,
          article: row.products.article ?? undefined,
        }
      : null,
  }));
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

// brandSlug narrows both scans to one brand — used by getAdminBrand, which
// otherwise paid for 2 full-table scans just to count usage for a single
// row (getAdminBrands legitimately needs the unfiltered counts, since it
// computes them for every brand at once). Same pattern as
// getCategoryUsageCounts above.
async function getBrandUsageCounts(
  supabase: ReturnType<typeof createAdminClient>,
  brandSlug?: string
): Promise<{ productCounts: Map<string, number>; categoryCounts: Map<string, number> }> {
  let productBrandsQuery = supabase.from("product_brands").select("brand_slug");
  let categoryBrandsQuery = supabase.from("category_brands").select("brand_slug");
  if (brandSlug) {
    productBrandsQuery = productBrandsQuery.eq("brand_slug", brandSlug);
    categoryBrandsQuery = categoryBrandsQuery.eq("brand_slug", brandSlug);
  }

  const [{ data: productBrands, error: pbError }, { data: categoryBrands, error: cbError }] = await Promise.all([
    productBrandsQuery,
    categoryBrandsQuery,
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

export async function getAdminBrand(slug: string): Promise<AdminBrand | null> {
  const supabase = createAdminClient();
  const [{ data, error }, { productCounts, categoryCounts }] = await Promise.all([
    supabase.from("brands").select("*").eq("slug", slug).maybeSingle(),
    getBrandUsageCounts(supabase, slug),
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
  type: "subcategory" | "brand" | null;
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
  type: "subcategory" | "brand" | null;
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

// vehicleTypeSlug narrows the scan to one vehicle type — used by
// getAdminVehicleType, same reasoning as getBrandUsageCounts above.
async function getVehicleTypeUsageCounts(
  supabase: ReturnType<typeof createAdminClient>,
  vehicleTypeSlug?: string
): Promise<Map<string, number>> {
  let query = supabase.from("product_vehicle_types").select("vehicle_type_slug");
  if (vehicleTypeSlug) query = query.eq("vehicle_type_slug", vehicleTypeSlug);
  const { data, error } = await query;
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

export async function getAdminVehicleType(slug: string): Promise<AdminVehicleType | null> {
  const supabase = createAdminClient();
  const [{ data, error }, productCounts] = await Promise.all([
    supabase.from("vehicle_types").select("*").eq("slug", slug).maybeSingle(),
    getVehicleTypeUsageCounts(supabase, slug),
  ]);
  if (error) throw error;
  return data ? mapVehicleType(data as VehicleTypeRow, productCounts) : null;
}
