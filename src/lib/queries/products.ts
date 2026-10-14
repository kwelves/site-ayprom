import { cache } from "react";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { activeCatalogReaderIfEnabled, catalogPublicationReadMode, CatalogPublicationReadError,
  type CatalogPublicationReader } from "@/lib/catalog-publication-reader";
import { normalizeSearchQuery } from "@/lib/normalize-search";
import {
  resolveCardImageUrl,
  resolveGalleryImageUrl,
  resolveImageFallbackUrl,
} from "@/lib/product-image-variants";
import {
  CATALOG_PAGE_SIZE,
  createCatalogSearchRequest,
  executeCatalogSearch,
  mapCatalogSearchRow,
  parseCatalogSearchRpcRows,
  type ProductFilters,
  type ProductPage,
} from "@/lib/catalog-search-contract";
import type { Product, ProductListItem } from "@/types/catalog";

export { CATALOG_PAGE_SIZE } from "@/lib/catalog-search-contract";
export type { ProductFilters, ProductPage } from "@/lib/catalog-search-contract";

const PRODUCT_SELECT = `
  slug, name, category_slug, short_description, description, article,
  meta_title, meta_description,
  subcategories(slug),
  product_images(url, "order", scale, thumbnail_url, gallery_url),
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
  meta_title: string | null;
  meta_description: string | null;
  subcategories: { slug: string } | null;
  product_images: {
    url: string;
    order: number;
    scale: number | null;
    thumbnail_url: string | null;
    gallery_url: string | null;
  }[];
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
    // Галерея/zoom/OG: приоритет gallery_url, thumbnail здесь не подходит по
    // размеру. resolved может быть сгенерированным вариантом, поэтому
    // fallbackUrl несёт неизменно надёжный master на случай его 404.
    images: [...row.product_images]
      .sort((a, b) => a.order - b.order)
      .map((img) => {
        const resolved = resolveGalleryImageUrl(img);
        return {
          url: resolved,
          fallbackUrl: resolveImageFallbackUrl(img, resolved),
          scale: img.scale ?? undefined,
        };
      }),
    shortDescription: row.short_description,
    description: row.description ?? undefined,
    characteristics: row.product_characteristics.length
      ? [...row.product_characteristics]
          .sort((a, b) => a.order - b.order)
          .map(({ attribute, value }) => ({ attribute, value }))
      : undefined,
    article: row.article ?? undefined,
    metaTitle: row.meta_title ?? undefined,
    metaDescription: row.meta_description ?? undefined,
  };
}

interface LegacyProductCardRow {
  slug: string;
  name: string;
  category_slug: string;
  short_description: string;
  article: string | null;
  subcategories: { slug: string } | null;
  product_images: {
    url: string;
    order: number;
    scale: number | null;
    thumbnail_url: string | null;
    gallery_url: string | null;
  }[];
  product_brands: { brand_slug: string }[];
}

export function parseCatalogPage(value?: string): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
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
    product_images(url, "order", scale, thumbnail_url, gallery_url),
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
  if (filters.withoutSubcategory) query = query.is("subcategory_id", null);
  if (filters.brandSlug) query = query.eq("brand_filter.brand_slug", filters.brandSlug);
  if (filters.vehicleTypeSlug) query = query.eq("vehicle_filter.vehicle_type_slug", filters.vehicleTypeSlug);
  if (filters.query?.trim()) {
    const normalized = normalizeSearchQuery(filters.query);
    query = query.or(`name.ilike.%${normalized}%,article.ilike.%${normalized}%`);
  }

  const { data, error, count } = await query;
  if (hasPostgrestCode(error, "PGRST103") && from > 0) {
    // Keep all filters while asking only for the first row. supabase-js does
    // not expose the exact count from the out-of-range 416 response.
    const retry = await query.range(0, 0);
    if (retry.error) throw retry.error;
    if (retry.count === null || retry.count > from) throw error;
    return { items: [], total: retry.count, page, pageSize, totalPages: Math.max(1, Math.ceil(retry.count / pageSize)) };
  }
  if (error) throw error;
  const total = count ?? 0;
  const items = (data as unknown as LegacyProductCardRow[]).map((row) =>
    mapCatalogSearchRow({
      slug: row.slug,
      name: row.name,
      category_slug: row.category_slug,
      subcategory_slug: row.subcategories?.slug ?? null,
      short_description: row.short_description,
      article: row.article,
      // Карточка каталога: приоритет thumbnail_url — см.
      // src/lib/product-image-variants.ts. RPC-путь (getProducts) уже
      // применяет тот же порядок в SQL; здесь его дублирует fallback-путь
      // (RPC отсутствует или ещё не знает require_no_subcategory).
      cover_url: row.product_images[0] ? resolveCardImageUrl(row.product_images[0]) : null,
      cover_fallback_url: row.product_images[0]
        ? resolveImageFallbackUrl(row.product_images[0], resolveCardImageUrl(row.product_images[0])) ?? null
        : null,
      cover_scale: row.product_images[0]?.scale ?? null,
      compatible_brands: row.product_brands.map((brand) => brand.brand_slug),
    }),
  );

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getProducts(filters: ProductFilters = {}): Promise<ProductPage> {
  const publicationMode = catalogPublicationReadMode();
  if (publicationMode === "pinned") {
    const reader = await activeCatalogReaderIfEnabled();
    if (!reader) throw new CatalogPublicationReadError();
    return getPinnedProductPage(filters, reader);
  }
  const supabase = await createClient();
  const request = createCatalogSearchRequest(filters);

  try {
    return await executeCatalogSearch(filters, async (searchRequest) => {
      const { data, error, count } = await supabase
        .rpc(
          "search_catalog_products",
          searchRequest.rpcArgs,
          { count: "exact" },
        )
        .range(searchRequest.from, searchRequest.to);

      if (hasPostgrestCode(error, "PGRST103") && searchRequest.from > 0) {
        // supabase-js reports PostgREST's out-of-range 416 as an error and
        // drops Content-Range. Re-read the first row only to recover the
        // exact filtered count without loading the catalog into memory.
        const retry = await supabase
          .rpc("search_catalog_products", searchRequest.rpcArgs, { count: "exact" })
          .range(0, 0);
        if (retry.error) throw retry.error;
        if (retry.count === null || retry.count > searchRequest.from) throw error;
        return { rows: [], count: retry.count };
      }
      if (error) throw error;
      return { rows: parseCatalogSearchRpcRows(data), count };
    });
  } catch (error) {
    // In publication mode a missing RPC is an outage, never permission to
    // expose editable source rows while static pages still show an old release.
    if (publicationMode === "active") throw error;
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
    if (hasPostgrestCode(error, "PGRST202") || hasPostgrestCode(error, "42883")) {
      Sentry.captureMessage("search_catalog_products RPC missing — serving catalog from legacy fallback", {
        level: "error",
        tags: { subsystem: "catalog-search", fallback: "legacy-product-page" },
        extra: {
          postgrestCode: error.code,
          message: error.message,
          // Новый режим требует миграции с require_no_subcategory: при
          // app-first выкладке сюда попадут именно такие запросы.
          requireNoSubcategory: request.rpcArgs.require_no_subcategory === true,
        },
      });
      return getLegacyProductPage(filters, request.page, request.pageSize);
    }
    throw error;
  }
}

async function getPinnedProductPage(filters: ProductFilters, reader: CatalogPublicationReader): Promise<ProductPage> {
  const request = createCatalogSearchRequest(filters);
  // Build-mode static pages never freeze a query-specific search result. The
  // browser uses the Worker RPC for q; refuse to approximate DB search_text.
  if (request.rpcArgs.search_query) throw new CatalogPublicationReadError();
  const rows = await reader.list<ProductRow & { order: number }>("product");
  const selected = rows.filter((row) =>
    (request.rpcArgs.category_filter === null || row.category_slug === request.rpcArgs.category_filter)
    && (request.rpcArgs.subcategory_filter === null || row.subcategories?.slug === request.rpcArgs.subcategory_filter)
    && (!request.rpcArgs.require_no_subcategory || row.subcategories === null)
    && (request.rpcArgs.brand_filter === null || row.product_brands.some((brand) => brand.brands.slug === request.rpcArgs.brand_filter))
    && (request.rpcArgs.vehicle_type_filter === null || row.product_vehicle_types.some((vehicle) => vehicle.vehicle_type_slug === request.rpcArgs.vehicle_type_filter)))
    .sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const items = selected.slice(request.from, request.to + 1).map((row) => {
    const image = [...row.product_images].sort((a, b) => a.order - b.order)[0];
    const cover = image ? resolveCardImageUrl(image) : null;
    return mapCatalogSearchRow({
      slug: row.slug, name: row.name, category_slug: row.category_slug,
      subcategory_slug: row.subcategories?.slug ?? null,
      short_description: row.short_description, article: row.article,
      cover_url: cover,
      cover_fallback_url: image && cover ? resolveImageFallbackUrl(image, cover) ?? null : null,
      cover_scale: image?.scale ?? null,
      compatible_brands: row.product_brands.map((brand) => brand.brands.slug),
    });
  });
  return { items, total: selected.length, page: request.page, pageSize: request.pageSize,
    totalPages: Math.max(1, Math.ceil(selected.length / request.pageSize)) };
}

function hasPostgrestCode(
  error: unknown,
  code: string,
): error is { code: string; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code &&
    "message" in error &&
    typeof error.message === "string"
  );
}

export async function getProductsWithoutSubcategory(
  categorySlug: string,
  page = 1,
  pageSize = CATALOG_PAGE_SIZE,
): Promise<ProductPage> {
  // Прямые товары смешанной категории идут через тот же контракт, что поиск и
  // Worker (`noSubcategory=1`): count и пагинация считаются в SQL только по
  // товарам без подкатегории, а нормализация страницы совпадает с Worker.
  return getProducts({ categorySlug, withoutSubcategory: true, page, pageSize });
}

export interface SitemapProduct extends ProductListItem {
  updatedAt: string;
}

export async function getSitemapProducts(): Promise<SitemapProduct[]> {
  const reader = await activeCatalogReaderIfEnabled();
  if (reader) {
    const rows = await reader.list<ProductRow & { updated_at: string }>("product");
    return rows.sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0).map((row) => ({
      ...mapCatalogSearchRow({
        slug: row.slug, name: row.name, category_slug: row.category_slug,
        subcategory_slug: row.subcategories?.slug ?? null,
        short_description: row.short_description, article: row.article,
        cover_url: row.product_images[0]?.url ?? null,
        cover_fallback_url: null, cover_scale: row.product_images[0]?.scale ?? null,
        compatible_brands: row.product_brands.map((brand) => brand.brands.slug),
      }),
      updatedAt: row.updated_at,
    }));
  }
  const supabase = await createClient();
  const batchSize = 1000;
  const products: SitemapProduct[] = [];

  for (let from = 0; ; from += batchSize) {
    const { data, error } = await supabase
      .from("products")
      .select(`
        slug, name, category_slug, short_description, article, updated_at,
        subcategories(slug),
        product_images(url, "order", scale, thumbnail_url, gallery_url),
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
        ...mapCatalogSearchRow({
          slug: row.slug,
          name: row.name,
          category_slug: row.category_slug,
          subcategory_slug: row.subcategories?.slug ?? null,
          short_description: row.short_description,
          article: row.article,
          // В sitemap нет браузерной fallback-цепочки, поэтому поисковику
          // отдаётся постоянный master, а не удаляемый WebP-вариант.
          cover_url: row.product_images[0]?.url ?? null,
          cover_fallback_url: null,
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
  const reader = await activeCatalogReaderIfEnabled();
  if (reader) {
    const row = await reader.get<ProductRow>("product", slug);
    return row ? mapProduct(row) : null;
  }
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
