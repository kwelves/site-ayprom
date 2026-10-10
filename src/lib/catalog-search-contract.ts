import type { ProductListItem } from "@/types/catalog";

export const CATALOG_PAGE_SIZE = 24;
const MAX_CATALOG_PAGE_SIZE = 48;

export interface ProductFilters {
  categorySlug?: string;
  subcategorySlug?: string;
  brandSlug?: string;
  vehicleTypeSlug?: string;
  query?: string;
  /**
   * Только товары без подкатегории — прямые товары смешанной категории.
   * Публичный URL-параметр `noSubcategory=1`; не путать с `subcategory=none`,
   * который остаётся обычным slug.
   */
  withoutSubcategory?: boolean;
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

export interface CatalogSearchRpcArgs {
  search_query: string | null;
  category_filter: string | null;
  subcategory_filter: string | null;
  brand_filter: string | null;
  vehicle_type_filter: string | null;
  /**
   * Передаётся только во включённом режиме. Обычные запросы сохраняют ровно
   * пять прежних аргументов, поэтому работают и со схемой до миграции.
   */
  require_no_subcategory?: true;
}

export type CatalogSearchFilterErrorCode =
  | "conflicting_subcategory_filters"
  | "invalid_no_subcategory";

/**
 * Противоречивые или неоднозначные фильтры. Запрос отвергается целиком: тихо
 * отбросить один из фильтров значило бы вернуть более широкую выборку, чем
 * просили.
 */
export class CatalogSearchFilterError extends Error {
  readonly code: CatalogSearchFilterErrorCode;

  constructor(code: CatalogSearchFilterErrorCode) {
    super(
      code === "conflicting_subcategory_filters"
        ? "Catalog search cannot combine a subcategory with noSubcategory"
        : "Catalog search noSubcategory accepts only the value 1",
    );
    this.name = "CatalogSearchFilterError";
    this.code = code;
  }
}

export interface CatalogSearchRpcRow {
  slug: string;
  name: string;
  category_slug: string;
  subcategory_slug: string | null;
  short_description: string;
  article: string | null;
  cover_url: string | null;
  cover_fallback_url: string | null;
  cover_scale: number | null;
  compatible_brands: string[] | null;
}

export interface CatalogSearchRequest {
  page: number;
  pageSize: number;
  from: number;
  to: number;
  rpcArgs: CatalogSearchRpcArgs;
}

export interface CatalogSearchRpcResult {
  rows: CatalogSearchRpcRow[];
  count: number | null;
}

export type CatalogSearchRpc = (
  request: CatalogSearchRequest,
) => Promise<CatalogSearchRpcResult>;

function optionalTrimmed(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value as number : fallback;
}

export function parseCatalogSearchParams(searchParams: URLSearchParams): ProductFilters {
  const pageValue = Number(searchParams.get("page"));
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const query = optionalTrimmed(searchParams.get("q"));
  const categorySlug = optionalTrimmed(searchParams.get("category"));
  const subcategorySlug = optionalTrimmed(searchParams.get("subcategory"));
  const brandSlug = optionalTrimmed(searchParams.get("brand"));
  const vehicleTypeSlug = optionalTrimmed(searchParams.get("vehicleType"));
  const noSubcategory = searchParams.get("noSubcategory");

  // Строгое значение: `noSubcategory=true` или пустое значение, принятые за
  // «выключено», молча вернули бы товары всех подкатегорий.
  if (noSubcategory !== null && noSubcategory !== "1") {
    throw new CatalogSearchFilterError("invalid_no_subcategory");
  }
  const withoutSubcategory = noSubcategory === "1";
  assertCompatibleSubcategoryFilters(subcategorySlug, withoutSubcategory);

  return {
    ...(query ? { query } : {}),
    page,
    ...(categorySlug ? { categorySlug } : {}),
    ...(subcategorySlug ? { subcategorySlug } : {}),
    ...(brandSlug ? { brandSlug } : {}),
    ...(vehicleTypeSlug ? { vehicleTypeSlug } : {}),
    ...(withoutSubcategory ? { withoutSubcategory } : {}),
  };
}

function assertCompatibleSubcategoryFilters(
  subcategorySlug: string | undefined,
  withoutSubcategory: boolean | undefined,
): void {
  if (subcategorySlug && withoutSubcategory) {
    throw new CatalogSearchFilterError("conflicting_subcategory_filters");
  }
}

export function createCatalogSearchRequest(filters: ProductFilters = {}): CatalogSearchRequest {
  const subcategorySlug = optionalTrimmed(filters.subcategorySlug);
  const withoutSubcategory = filters.withoutSubcategory === true;
  assertCompatibleSubcategoryFilters(subcategorySlug, withoutSubcategory);

  const pageSize = Math.min(MAX_CATALOG_PAGE_SIZE, positiveInteger(filters.pageSize, CATALOG_PAGE_SIZE));
  const candidatePage = positiveInteger(filters.page, 1);
  const candidateFrom = (candidatePage - 1) * pageSize;
  const candidateTo = candidateFrom + pageSize - 1;
  const page = Number.isSafeInteger(candidateFrom) && Number.isSafeInteger(candidateTo)
    ? candidatePage
    : 1;
  const from = (page - 1) * pageSize;

  return {
    page,
    pageSize,
    from,
    to: from + pageSize - 1,
    rpcArgs: {
      search_query: optionalTrimmed(filters.query) ?? null,
      category_filter: optionalTrimmed(filters.categorySlug) ?? null,
      subcategory_filter: subcategorySlug ?? null,
      brand_filter: optionalTrimmed(filters.brandSlug) ?? null,
      vehicle_type_filter: optionalTrimmed(filters.vehicleTypeSlug) ?? null,
      ...(withoutSubcategory ? { require_no_subcategory: true as const } : {}),
    },
  };
}

export function mapCatalogSearchRow(row: CatalogSearchRpcRow): ProductListItem {
  const image = row.cover_url
    ? {
        url: row.cover_url,
        fallbackUrl: row.cover_fallback_url ?? undefined,
        scale: row.cover_scale ?? undefined,
      }
    : null;

  return {
    slug: row.slug,
    name: row.name,
    category: row.category_slug,
    subcategory: row.subcategory_slug ?? undefined,
    compatibleBrands: row.compatible_brands ?? [],
    images: image ? [image] : [],
    shortDescription: row.short_description,
    article: row.article ?? undefined,
  };
}

export function buildCatalogSearchPage(
  rows: CatalogSearchRpcRow[],
  count: number | null,
  request: Pick<CatalogSearchRequest, "page" | "pageSize">,
): ProductPage {
  if (!Number.isSafeInteger(count) || (count ?? -1) < 0) {
    throw new TypeError("Catalog search RPC did not return a valid exact count");
  }

  const total = count as number;

  return {
    items: rows.map(mapCatalogSearchRow),
    total,
    page: request.page,
    pageSize: request.pageSize,
    totalPages: Math.max(1, Math.ceil(total / request.pageSize)),
  };
}

export function parseCatalogSearchRpcRows(value: unknown): CatalogSearchRpcRow[] {
  if (!Array.isArray(value) || !value.every(isCatalogSearchRpcRow)) {
    throw new TypeError("Catalog search RPC returned an invalid payload");
  }

  return value;
}

export async function executeCatalogSearch(
  filters: ProductFilters,
  searchRpc: CatalogSearchRpc,
): Promise<ProductPage> {
  const request = createCatalogSearchRequest(filters);
  const result = await searchRpc(request);

  return buildCatalogSearchPage(result.rows, result.count, request);
}

function isCatalogSearchRpcRow(value: unknown): value is CatalogSearchRpcRow {
  if (!isRecord(value)) return false;

  return (
    typeof value.slug === "string" &&
    typeof value.name === "string" &&
    typeof value.category_slug === "string" &&
    isNullableString(value.subcategory_slug) &&
    typeof value.short_description === "string" &&
    isNullableString(value.article) &&
    isNullableString(value.cover_url) &&
    isNullableString(value.cover_fallback_url) &&
    (value.cover_scale === null || typeof value.cover_scale === "number") &&
    (value.compatible_brands === null ||
      (Array.isArray(value.compatible_brands) &&
        value.compatible_brands.every((brand) => typeof brand === "string")))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
