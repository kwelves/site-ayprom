// Private, unwired PostgREST ports for the existing atomic product RPCs.
// Only a future authenticated, CSRF-protected admin handler may call these.
// This module does not expose HTTP routes or replace the Next/Vercel actions.
import { isProductAvailability, type ProductAvailability } from "@/lib/admin/product-availability";
import { requestAdminJson } from "./json-request";

export interface ProductMutationFields {
  slugBase: string;
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
  characteristics: { attribute: string; value: string }[];
  compatibleBrands: string[];
  vehicleTypes: string[];
}

export type AdminProductMutationErrorCode = "configuration_invalid" | "input_invalid" | "conflict" | "backend_unavailable" | "response_invalid";

export class AdminProductMutationError extends Error {
  constructor(readonly code: AdminProductMutationErrorCode) {
    super(code === "conflict" ? "Product changed concurrently" : "Product mutation unavailable");
    this.name = "AdminProductMutationError";
  }
}

interface Config { base: URL; key: string }
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseConfig(bindings: { SUPABASE_URL: string; ADMIN_SUPABASE_KEY: string }): Config | null {
  const key = typeof bindings?.ADMIN_SUPABASE_KEY === "string" ? bindings.ADMIN_SUPABASE_KEY.trim() : "";
  if (!key || /[^!-~]/.test(key)) return null;
  try {
    const base = new URL(bindings.SUPABASE_URL);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) return null;
    base.search = "";
    base.hash = "";
    return { base, key };
  } catch {
    return null;
  }
}

function validFields(fields: ProductMutationFields): boolean {
  const nullableText = (value: unknown) => value === null || typeof value === "string";
  return !!fields && slugPattern.test(fields.slugBase)
    && typeof fields.name === "string" && !!fields.name.trim()
    && typeof fields.categorySlug === "string" && !!fields.categorySlug.trim()
    && nullableText(fields.subcategorySlug) && typeof fields.shortDescription === "string"
    && nullableText(fields.description) && nullableText(fields.article)
    && typeof fields.published === "boolean" && isProductAvailability(fields.availability)
    && nullableText(fields.metaTitle) && nullableText(fields.metaDescription)
    && Array.isArray(fields.characteristics) && fields.characteristics.every((row) =>
      row && typeof row.attribute === "string" && typeof row.value === "string")
    && Array.isArray(fields.compatibleBrands) && fields.compatibleBrands.every((value) => typeof value === "string")
    && Array.isArray(fields.vehicleTypes) && fields.vehicleTypes.every((value) => typeof value === "string");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function commonBody(fields: ProductMutationFields) {
  return {
    p_name: fields.name,
    p_category_slug: fields.categorySlug,
    p_subcategory_slug: fields.subcategorySlug,
    p_short_description: fields.shortDescription,
    p_description: fields.description,
    p_article: fields.article,
    p_published: fields.published,
    p_availability: fields.availability,
    p_meta_title: fields.metaTitle,
    p_meta_description: fields.metaDescription,
    p_characteristics: fields.characteristics,
    p_compatible_brands: fields.compatibleBrands,
    p_vehicle_types: fields.vehicleTypes,
  };
}

export function createAdminProductMutationPorts(
  bindings: { SUPABASE_URL: string; ADMIN_SUPABASE_KEY: string },
  fetcher: typeof fetch = fetch,
) {
  const config = parseConfig(bindings);

  async function call(rpc: "create_product_with_relations" | "update_product_with_slug", body: Record<string, unknown>): Promise<unknown> {
    if (!config) throw new AdminProductMutationError("configuration_invalid");
    const url = new URL(config.base);
    url.pathname = `/rest/v1/rpc/${rpc}`;
    const headers = new Headers({ apikey: config.key, accept: "application/json", "content-type": "application/json" });
    if (config.key.startsWith("eyJ")) headers.set("authorization", `Bearer ${config.key}`);
    let result: Awaited<ReturnType<typeof requestAdminJson>>;
    try {
      // PostgREST maps SQLSTATE 55000 (our stale-version exception) to HTTP
      // 500. Accept that bounded body only for this RPC so we can classify the
      // exact code; every other HTTP 500 still fails closed below.
      const acceptedStatuses = rpc === "update_product_with_slug" ? [400, 409, 500] : [400, 409];
      result = await requestAdminJson(url, { method: "POST", headers, body: JSON.stringify(body) }, fetcher, { acceptedStatuses });
    } catch {
      throw new AdminProductMutationError("backend_unavailable");
    }
    if (rpc === "update_product_with_slug" && (result.status === 400 || result.status === 500)
      && record(result.payload)?.code === "55000") {
      throw new AdminProductMutationError("conflict");
    }
    // SQLSTATE 22023 is the RPCs' intentional input refusal (unknown or repeated
    // reference, taken slug, missing product); PostgREST maps it to HTTP 400.
    // Same two intentional codes as the legacy toProductRpcError; the database
    // message itself is never forwarded.
    if (result.status === 400 && record(result.payload)?.code === "22023") {
      throw new AdminProductMutationError("input_invalid");
    }
    if (!result.ok) throw new AdminProductMutationError("backend_unavailable");
    return result.payload;
  }

  return {
    async create(fields: ProductMutationFields): Promise<{ id: string; slug: string }> {
      if (!validFields(fields)) throw new AdminProductMutationError("input_invalid");
      const payload = await call("create_product_with_relations", { p_slug_base: fields.slugBase, ...commonBody(fields) });
      const row = Array.isArray(payload) && payload.length === 1 ? record(payload[0]) : null;
      if (!row || typeof row.out_id !== "string" || !uuidPattern.test(row.out_id)
        || typeof row.out_slug !== "string" || !slugPattern.test(row.out_slug)) {
        throw new AdminProductMutationError("response_invalid");
      }
      return { id: row.out_id, slug: row.out_slug };
    },

    async update(input: {
      slug: string; newSlug: string; expectedUpdatedAt: string; fields: ProductMutationFields;
    }): Promise<{ id: string; updatedAt: string }> {
      if (!input || !slugPattern.test(input.slug) || !slugPattern.test(input.newSlug)
        || typeof input.expectedUpdatedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(input.expectedUpdatedAt)
        || !validFields(input.fields)) throw new AdminProductMutationError("input_invalid");
      const payload = await call("update_product_with_slug", {
        p_slug: input.slug, p_new_slug: input.newSlug, p_expected_updated_at: input.expectedUpdatedAt,
        ...commonBody(input.fields),
      });
      const row = Array.isArray(payload) && payload.length === 1 ? record(payload[0]) : null;
      if (!row || typeof row.out_id !== "string" || !uuidPattern.test(row.out_id)
        || typeof row.out_updated_at !== "string" || !row.out_updated_at) {
        throw new AdminProductMutationError("response_invalid");
      }
      return { id: row.out_id, updatedAt: row.out_updated_at };
    },
  };
}
