import { createHash } from "node:crypto";
import { localProbeBindings } from "../local-browser-probe";
import { validateCatalogSnapshot, type CatalogSnapshot } from "../snapshot";
import { resolveWorkersBuildBinding } from "./workers-build-config";

const PAGE_SIZE = 1000;
const PRODUCT_SELECT = "slug,name,category_slug,short_description,article,updated_at,subcategories(slug),product_images(url,order,scale),product_brands(brand_slug),product_vehicle_types(vehicle_type_slug)";

interface ProductRow {
  slug: string;
  name: string;
  category_slug: string;
  short_description: string;
  article: string | null;
  updated_at: string;
  subcategories: { slug: string } | null;
  product_images: { url: string; order: number; scale: number | null }[];
  product_brands: { brand_slug: string }[];
  product_vehicle_types: { vehicle_type_slug: string }[];
}

/** Read-only local PostgREST source for a diagnostic, never a release export. */
export async function loadLocalCatalogSnapshot(input: {
  url: string;
  key: string;
  fetchImpl?: typeof fetch;
  acceptance?: "loopback" | "workers-build";
  allowlist?: readonly string[];
}): Promise<CatalogSnapshot> {
  const bindings = input.acceptance === "workers-build"
    ? acceptWorkersBuildBinding(input.url, input.key, input.allowlist ?? [])
    : localProbeBindings(input.url, input.key);
  const fetchImpl = input.fetchImpl ?? fetch;
  const read = async (table: string, select: string, offset = 0): Promise<{ rows: unknown[]; total: number }> => {
    const requestUrl = new URL(`/rest/v1/${table}`, bindings.SUPABASE_URL);
    requestUrl.searchParams.set("select", select);
    requestUrl.searchParams.set("order", table === "category_brands"
      ? "category_slug.asc,brand_slug.asc"
      : table === "subcategories" ? "slug.asc,category_slug.asc" : "slug.asc");
    requestUrl.searchParams.set("limit", String(PAGE_SIZE));
    requestUrl.searchParams.set("offset", String(offset));
    const response = await fetchImpl(requestUrl, {
      method: "GET",
      headers: {
        apikey: bindings.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${bindings.SUPABASE_PUBLISHABLE_KEY}`,
        Prefer: "count=exact",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`local_snapshot_http_error:${table}:${response.status}`);
    let data: unknown;
    try { data = await response.json(); }
    catch { throw new Error(`local_snapshot_invalid_response:${table}`); }
    if (!Array.isArray(data)) throw new Error(`local_snapshot_invalid_response:${table}`);
    const range = response.headers.get("content-range");
    if (data.length === 0 && offset === 0 && range === "*/0") return { rows: data, total: 0 };
    const match = /^(\d+)-(\d+)\/(\d+)$/.exec(range ?? "");
    if (!match) throw new Error(`local_snapshot_count_invalid:${table}`);
    const [, startText, endText, totalText] = match;
    const start = Number(startText);
    const end = Number(endText);
    const total = Number(totalText);
    if (![start, end, total].every(Number.isSafeInteger) || start !== offset
      || data.length === 0 || data.length > PAGE_SIZE || end !== start + data.length - 1
      || end >= total) throw new Error(`local_snapshot_count_invalid:${table}`);
    return { rows: data, total };
  };
  const readAll = async (table: string, select: string): Promise<unknown[]> => {
    const rows: unknown[] = [];
    let expectedTotal: number | null = null;
    for (;;) {
      const page = await read(table, select, rows.length);
      if (expectedTotal !== null && page.total !== expectedTotal) {
        throw new Error(`local_snapshot_count_changed:${table}`);
      }
      expectedTotal = page.total;
      rows.push(...page.rows);
      if (rows.length === expectedTotal) return rows;
      if (page.rows.length === 0 || rows.length > expectedTotal) {
        throw new Error(`local_snapshot_count_invalid:${table}`);
      }
    }
  };
  const [categoryRows, subcategoryRows, brandRows, vehicleRows, categoryBrandRows, productRows] = await Promise.all([
    readAll("categories", "slug,name,type"),
    readAll("subcategories", "slug,name,category_slug"),
    readAll("brands", "slug,name"),
    readAll("vehicle_types", "slug,name"),
    readAll("category_brands", "category_slug,brand_slug"),
    readAll("products", PRODUCT_SELECT),
  ]);
  const categories = categoryRows as CatalogSnapshot["categories"];
  const subcategories = (subcategoryRows as { slug: string; name: string; category_slug: string }[])
    .map((row) => ({ slug: row.slug, name: row.name, categorySlug: row.category_slug }));
  const brands = brandRows as CatalogSnapshot["brands"];
  const vehicleTypes = vehicleRows as CatalogSnapshot["vehicleTypes"];
  const categoryBrands: Record<string, string[]> = {};
  for (const row of categoryBrandRows as { category_slug: string; brand_slug: string }[]) {
    (categoryBrands[row.category_slug] ??= []).push(row.brand_slug);
  }
  for (const list of Object.values(categoryBrands)) list.sort();
  const products = (productRows as ProductRow[]).map((row) => ({
    slug: row.slug,
    name: row.name,
    category: row.category_slug,
    ...(row.subcategories?.slug ? { subcategory: row.subcategories.slug } : {}),
    compatibleBrands: row.product_brands.map((item) => item.brand_slug).sort(),
    vehicleTypes: row.product_vehicle_types.map((item) => item.vehicle_type_slug).sort(),
    images: [...row.product_images].sort((a, b) => a.order - b.order || a.url.localeCompare(b.url))
      .slice(0, 1).map((image) => ({ url: image.url, ...(image.scale === null ? {} : { scale: image.scale }) })),
    shortDescription: row.short_description,
    ...(row.article === null ? {} : { article: row.article }),
    updatedAt: row.updated_at,
  }));
  const contents = {
    schemaVersion: 1 as const,
    categories,
    subcategories,
    brands,
    vehicleTypes,
    categoryBrands,
    directProductCategorySlugs: categories.filter((category) => category.type !== "brand").map((category) => category.slug),
    products,
  };
  const snapshotId = `local-${createHash("sha256").update(JSON.stringify(contents)).digest("hex").slice(0, 16)}`;
  const validated = validateCatalogSnapshot({ ...contents, snapshotId });
  if (!validated.ok) throw new Error("local_snapshot_invalid");
  return validated.value;
}

function acceptWorkersBuildBinding(url: string, key: string, allowlist: readonly string[]) {
  const resolved = resolveWorkersBuildBinding({ mode: "workers-build", supabaseUrl: url, publishableKey: key, allowlist });
  if (!resolved.ok) throw new Error(resolved.code);
  return { SUPABASE_URL: resolved.url, SUPABASE_PUBLISHABLE_KEY: resolved.key };
}
