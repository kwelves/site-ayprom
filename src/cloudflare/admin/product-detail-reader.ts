// Private read of ONE product for the thin admin edit form. The handler must
// validate the session and its password version before calling it: the row may
// be an unpublished draft. Transport limits (10 s, 64 KiB, manual redirects
// rejected, no retries) are requestAdminJson's; the private key travels only in
// request headers. This does not replace the Next/Vercel getAdminProduct.
import { isProductAvailability, type ProductAvailability } from "@/lib/admin/product-availability";
import { requestAdminJson } from "./json-request";

/**
 * Everything update_product_with_slug replaces, so an unchanged save cannot
 * drop a relation, plus the exact `updated_at` string for compare-and-set.
 */
export interface AdminProductDetail {
  id: string;
  slug: string;
  name: string;
  categorySlug: string;
  subcategorySlug: string | null;
  shortDescription: string;
  description: string | null;
  article: string | null;
  published: boolean;
  availability: ProductAvailability;
  metaTitle: string | null;
  metaDescription: string | null;
  /** Verbatim from PostgREST (microseconds): never parse it into a Date. */
  updatedAt: string;
  characteristics: { attribute: string; value: string }[];
  compatibleBrands: string[];
  vehicleTypes: string[];
  /** Showcase hotspots that an unpublish would detach (legacy form warns too). */
  hotspotCount: number;
}

export type AdminProductDetailReader = (slug: string) => Promise<AdminProductDetail | null>;

export const ADMIN_PRODUCT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_ADMIN_PRODUCT_SLUG_LENGTH = 200;
/** Upper bound for each replaced relation list, on read and on save. */
export const MAX_ADMIN_PRODUCT_RELATIONS = 100;
export const ADMIN_PRODUCT_TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECT = [
  "id", "slug", "name", "category_slug", "short_description", "description", "article", "published",
  "availability", "meta_title", "meta_description", "updated_at", "subcategories(slug)",
  "product_characteristics(attribute,value,order)", "product_brands(brand_slug)",
  "product_vehicle_types(vehicle_type_slug)", "vehicle_hotspots(id)",
].join(",");

export function isAdminProductSlug(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_ADMIN_PRODUCT_SLUG_LENGTH && ADMIN_PRODUCT_SLUG.test(value);
}

function unavailable(): Error { return new Error("Admin product unavailable"); }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw unavailable();
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function list<T>(value: unknown, map: (item: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(value) || value.length > MAX_ADMIN_PRODUCT_RELATIONS) throw unavailable();
  return value.map((item) => map(record(item)));
}

function slugOf(value: unknown): string {
  if (!isAdminProductSlug(value)) throw unavailable();
  return value;
}

function detail(value: unknown, slug: string): AdminProductDetail {
  const row = record(value);
  if (typeof row.id !== "string" || !UUID.test(row.id) || row.slug !== slug || typeof row.published !== "boolean"
    || typeof row.updated_at !== "string" || !ADMIN_PRODUCT_TIMESTAMP.test(row.updated_at)
    || typeof row.availability !== "string" || !isProductAvailability(row.availability)) throw unavailable();
  const subcategory = row.subcategories === null ? null : slugOf(record(row.subcategories).slug);
  const characteristics = list(row.product_characteristics, (item) => {
    if (!Number.isSafeInteger(item.order)) throw unavailable();
    return { attribute: text(item.attribute), value: text(item.value), order: item.order as number };
  });
  return {
    id: row.id,
    slug,
    name: text(row.name),
    categorySlug: text(row.category_slug),
    subcategorySlug: subcategory,
    shortDescription: text(row.short_description),
    description: nullableText(row.description),
    article: nullableText(row.article),
    published: row.published,
    availability: row.availability,
    metaTitle: nullableText(row.meta_title),
    metaDescription: nullableText(row.meta_description),
    updatedAt: row.updated_at,
    // Same order as the legacy edit form: by the stored position, stable on ties.
    characteristics: characteristics
      .map((item, index) => ({ ...item, index }))
      .sort((a, b) => a.order - b.order || a.index - b.index)
      .map(({ attribute, value: itemValue }) => ({ attribute, value: itemValue })),
    compatibleBrands: list(row.product_brands, (item) => text(item.brand_slug)),
    vehicleTypes: list(row.product_vehicle_types, (item) => text(item.vehicle_type_slug)),
    hotspotCount: list(row.vehicle_hotspots, (item) => text(item.id)).length,
  };
}

export function createAdminProductDetailReader(
  bindings: { SUPABASE_URL: string; ADMIN_SUPABASE_KEY: string }, fetcher: typeof fetch = fetch,
): AdminProductDetailReader {
  return async (slug) => {
    let stage = "request";
    try {
      if (!isAdminProductSlug(slug)) throw unavailable();
      const key = typeof bindings?.ADMIN_SUPABASE_KEY === "string" ? bindings.ADMIN_SUPABASE_KEY.trim() : "";
      if (!key || /[^!-~]/.test(key)) throw unavailable();
      const url = new URL(bindings.SUPABASE_URL);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw unavailable();
      url.pathname = "/rest/v1/products"; url.search = ""; url.hash = "";
      url.searchParams.set("select", SELECT);
      url.searchParams.set("slug", `eq.${slug}`);
      // Two rows would mean the unique slug contract is broken: refuse, never pick one.
      url.searchParams.set("limit", "2");
      const headers = new Headers({ apikey: key, accept: "application/json" });
      if (key.startsWith("eyJ")) headers.set("authorization", `Bearer ${key}`);
      stage = "fetch";
      const { payload } = await requestAdminJson(url, { method: "GET", headers }, fetcher);
      stage = "rows";
      if (!Array.isArray(payload) || payload.length > 1) throw unavailable();
      return payload.length === 0 ? null : detail(payload[0], slug);
    } catch {
      console.error(JSON.stringify({ code: "admin_product_unavailable", stage }));
      throw unavailable();
    }
  };
}
