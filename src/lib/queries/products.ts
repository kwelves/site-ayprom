import { cache } from "react";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { normalizeSearchQuery } from "@/lib/normalize-search";
import type { Product, ProductListItem } from "@/types/catalog";

const PRODUCT_SELECT = `
  slug, name, category_slug, short_description, description, article,
  subcategories(slug),
  product_images(url, "order", scale),
  product_characteristics(attribute, value, "order"),
  product_brands(brands(slug, name, country, logo, logo_scale)),
  product_vehicle_types(vehicle_type_slug)
`;

interface ProductRow {
  slug: string;
  name: string;
  category_slug: string;
  short_description: string;
  description: string | null;
  article: string | null;
  subcategories: { slug: string } | null;
  product_images: { url: string; order: number; scale: number | null }[];
  product_characteristics: { attribute: string; value: string; order: number }[];
  product_brands: { brands: { slug: string } }[];
  product_vehicle_types: { vehicle_type_slug: string }[];
}

function mapProduct(row: ProductRow): Product {
  return {
    slug: row.slug,
    name: row.name,
    category: row.category_slug,
    subcategory: row.subcategories?.slug,
    compatibleBrands: row.product_brands.map((pb) => pb.brands.slug),
    vehicleTypes: row.product_vehicle_types.map((pvt) => pvt.vehicle_type_slug),
    images: [...row.product_images]
      .sort((a, b) => a.order - b.order)
      .map((img) => ({ url: img.url, scale: img.scale ?? undefined })),
    shortDescription: row.short_description,
    description: row.description ?? undefined,
    characteristics: row.product_characteristics.length
      ? [...row.product_characteristics]
          .sort((a, b) => a.order - b.order)
          .map(({ attribute, value }) => ({ attribute, value }))
      : undefined,
    article: row.article ?? undefined,
  };
}

export const CATALOG_PAGE_SIZE = 24;

export interface ProductFilters {
  categorySlug?: string;
  subcategorySlug?: string;
  brandSlug?: string;
  vehicleTypeSlug?: string;
  query?: string;
  page?: number;
  pageSize?: number;
}

export interface ProductPage {
  items: ProductListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface ProductCardRpcRow {
  slug: string;
  name: string;
  category_slug: string;
  subcategory_slug: string | null;
  short_description: string;
  article: string | null;
  cover_url: string | null;
  cover_scale: number | null;
  compatible_brands: string[] | null;
}

interface LegacyProductCardRow {
  slug: string;
  name: string;
  category_slug: string;
  short_description: string;
  article: string | null;
  subcategories: { slug: string } | null;
  product_images: { url: string; order: number; scale: number | null }[];
  product_brands: { brand_slug: string }[];
}

export function parseCatalogPage(value?: string): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function mapProductCard(row: ProductCardRpcRow): ProductListItem {
  return {
    slug: row.slug,
    name: row.name,
    category: row.category_slug,
    subcategory: row.subcategory_slug ?? undefined,
    compatibleBrands: row.compatible_brands ?? [],
    images: row.cover_url ? [{ url: row.cover_url, scale: row.cover_scale ?? undefined }] : [],
    shortDescription: row.short_description,
    article: row.article ?? undefined,
  };
}

async function getLegacyProductPage(filters: ProductFilters, page: number, pageSize: number): Promise<ProductPage> {
  const supabase = await createClient();
  const relationSelect = [
    filters.brandSlug ? "brand_filter:product_brands!inner(brand_slug)" : null,
    filters.vehicleTypeSlug ? "vehicle_filter:product_vehicle_types!inner(vehicle_type_slug)" : null,
  ]
    .filter(Boolean)
    .join(",");
  const subcategorySelect = filters.subcategorySlug ? "subcategories!inner(slug)" : "subcategories(slug)";
  const cardSelect = `
    slug, name, category_slug, short_description, article,
    ${subcategorySelect},
    product_images(url, "order", scale),
    product_brands(brand_slug)
    ${relationSelect ? `,${relationSelect}` : ""}
  `;
  const from = (page - 1) * pageSize;
  let query = supabase
    .from("products")
    .select(cardSelect, { count: "exact" })
    .order("order")
    .order("order", { referencedTable: "product_images" })
    .limit(1, { referencedTable: "product_images" })
    .range(from, from + pageSize - 1);

  if (filters.categorySlug) query = query.eq("category_slug", filters.categorySlug);
  if (filters.subcategorySlug) query = query.eq("subcategories.slug", filters.subcategorySlug);
  if (filters.brandSlug) query = query.eq("brand_filter.brand_slug", filters.brandSlug);
  if (filters.vehicleTypeSlug) query = query.eq("vehicle_filter.vehicle_type_slug", filters.vehicleTypeSlug);
  if (filters.query?.trim()) {
    const normalized = normalizeSearchQuery(filters.query);
    query = query.or(`name.ilike.%${normalized}%,article.ilike.%${normalized}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  const total = count ?? 0;
  const items = (data as unknown as LegacyProductCardRow[]).map((row) =>
    mapProductCard({
      slug: row.slug,
      name: row.name,
      category_slug: row.category_slug,
      subcategory_slug: row.subcategories?.slug ?? null,
      short_description: row.short_description,
      article: row.article,
      cover_url: row.product_images[0]?.url ?? null,
      cover_scale: row.product_images[0]?.scale ?? null,
      compatible_brands: row.product_brands.map((brand) => brand.brand_slug),
    }),
  );

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getProducts(filters: ProductFilters = {}): Promise<ProductPage> {
  const supabase = await createClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(48, Math.max(1, filters.pageSize ?? CATALOG_PAGE_SIZE));
  const from = (page - 1) * pageSize;
  const { data, error, count } = await supabase
    .rpc(
      "search_catalog_products",
      {
        search_query: filters.query?.trim() || null,
        category_filter: filters.categorySlug ?? null,
        subcategory_filter: filters.subcategorySlug ?? null,
        brand_filter: filters.brandSlug ?? null,
        vehicle_type_filter: filters.vehicleTypeSlug ?? null,
      },
      { count: "exact" },
    )
    .range(from, from + pageSize - 1);

  // Keeps the site usable while a newly deployed application waits for the
  // migration to be applied. Once the RPC exists, every catalog/search path
  // uses the indexed backend implementation above.
  //
  // Reported to Sentry rather than taken silently, and that is the whole
  // point. Two features in this codebase — backend search and the admin login
  // rate limit — were broken for months precisely because their fallbacks
  // engaged without a sound: the site kept working, the logs stayed clean, and
  // nothing indicated the real implementation had never run. A fallback that
  // hides a missing migration is worse than an outage, because nobody goes
  // looking. If this fires in production, the deploy is half-applied.
  if (error?.code === "PGRST202" || error?.code === "42883") {
    Sentry.captureMessage("search_catalog_products RPC missing — serving catalog from legacy fallback", {
      level: "error",
      tags: { subsystem: "catalog-search", fallback: "legacy-product-page" },
      extra: { postgrestCode: error.code, message: error.message },
    });
    return getLegacyProductPage(filters, page, pageSize);
  }
  if (error) throw error;

  const total = count ?? 0;
  return {
    items: (data as unknown as ProductCardRpcRow[]).map(mapProductCard),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export interface SitemapProduct extends ProductListItem {
  updatedAt: string;
}

export async function getSitemapProducts(): Promise<SitemapProduct[]> {
  const supabase = await createClient();
  const batchSize = 1000;
  const products: SitemapProduct[] = [];

  for (let from = 0; ; from += batchSize) {
    const { data, error } = await supabase
      .from("products")
      .select(`
        slug, name, category_slug, short_description, article, updated_at,
        subcategories(slug),
        product_images(url, "order", scale),
        product_brands(brand_slug)
      `)
      .order("slug")
      .order("order", { referencedTable: "product_images" })
      .limit(1, { referencedTable: "product_images" })
      .range(from, from + batchSize - 1);
    if (error) throw error;

    const rows = data as unknown as (LegacyProductCardRow & { updated_at: string })[];
    products.push(
      ...rows.map((row) => ({
        ...mapProductCard({
          slug: row.slug,
          name: row.name,
          category_slug: row.category_slug,
          subcategory_slug: row.subcategories?.slug ?? null,
          short_description: row.short_description,
          article: row.article,
          cover_url: row.product_images[0]?.url ?? null,
          cover_scale: row.product_images[0]?.scale ?? null,
          compatible_brands: row.product_brands.map((brand) => brand.brand_slug),
        }),
        updatedAt: row.updated_at,
      })),
    );

    if (rows.length < batchSize) break;
  }

  return products;
}

// Wrapped in cache() so generateMetadata and the page body — which both
// call this with the same slug — share one Supabase request per render
// instead of two.
export const getProduct = cache(async (slug: string): Promise<Product | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("slug", slug)
    .order("order", { referencedTable: "product_images" })
    .order("order", { referencedTable: "product_characteristics" })
    .maybeSingle();
  if (error) throw error;
  return data ? mapProduct(data as unknown as ProductRow) : null;
});
