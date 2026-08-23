import { isProductAvailability, type ProductAvailability } from "@/lib/admin/product-availability";

export const ADMIN_PRODUCT_LIST_CONFIG_COOKIE = "admin_products_list_config";
export const ADMIN_PRODUCT_LIST_CONFIG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const ADMIN_PRODUCT_LIST_RESET_EVENT = "admin-product-list-reset";

export interface AdminProductListResetEventDetail {
  q?: string;
}

export type AdminProductListStatus = "" | "published" | "draft";
export type AdminProductListSort = "order" | "name" | "updated";
export type AdminProductListViewMode = "explicit" | "target";

export interface AdminProductListConfig {
  category: string;
  status: AdminProductListStatus;
  availability: "" | ProductAvailability;
  sort: AdminProductListSort;
}

interface StoredAdminProductListConfig extends AdminProductListConfig {
  v: 1;
}

export const DEFAULT_ADMIN_PRODUCT_LIST_CONFIG: AdminProductListConfig = {
  category: "",
  status: "",
  availability: "",
  sort: "order",
};

const VALID_STATUSES: readonly AdminProductListStatus[] = ["", "published", "draft"];
const VALID_SORTS: readonly AdminProductListSort[] = ["order", "name", "updated"];

function isCategorySlug(value: unknown): value is string {
  return typeof value === "string" && value.length <= 120 && !/[\s/?#&]/.test(value);
}

export function parseAdminProductListConfigCookie(value: string | undefined | null): AdminProductListConfig | null {
  if (!value) return null;

  try {
    const decoded = decodeURIComponent(value);
    const parsed = JSON.parse(decoded) as Partial<StoredAdminProductListConfig>;
    if (
      parsed.v !== 1 ||
      !isCategorySlug(parsed.category) ||
      !VALID_STATUSES.includes(parsed.status as AdminProductListStatus) ||
      !(parsed.availability === "" || isProductAvailability(parsed.availability)) ||
      !VALID_SORTS.includes(parsed.sort as AdminProductListSort)
    ) {
      return null;
    }

    return {
      category: parsed.category,
      status: parsed.status as AdminProductListStatus,
      availability: parsed.availability as AdminProductListConfig["availability"],
      sort: parsed.sort as AdminProductListSort,
    };
  } catch {
    return null;
  }
}

export function serializeAdminProductListConfigCookie(config: AdminProductListConfig): string {
  const stored: StoredAdminProductListConfig = { v: 1, ...config };
  return encodeURIComponent(JSON.stringify(stored));
}

export function parseAdminProductListConfigFromUrl(params: {
  category?: string;
  status?: string;
  availability?: string;
  sort?: string;
}): AdminProductListConfig {
  return {
    category: isCategorySlug(params.category) ? params.category : "",
    status: VALID_STATUSES.includes(params.status as AdminProductListStatus)
      ? (params.status as AdminProductListStatus)
      : "",
    availability: isProductAvailability(params.availability) ? params.availability : "",
    sort: VALID_SORTS.includes(params.sort as AdminProductListSort)
      ? (params.sort as AdminProductListSort)
      : "order",
  };
}

export function resolveAdminProductListConfig(
  params: {
    view?: string;
    category?: string;
    status?: string;
    availability?: string;
    sort?: string;
  },
  savedConfig: AdminProductListConfig | null,
): { config: AdminProductListConfig; view: AdminProductListViewMode | null } {
  if (params.view === "explicit" || params.view === "target") {
    return {
      config: parseAdminProductListConfigFromUrl(params),
      view: params.view,
    };
  }

  return {
    config: savedConfig ?? DEFAULT_ADMIN_PRODUCT_LIST_CONFIG,
    view: null,
  };
}

export function normalizeAdminProductListCategory(
  config: AdminProductListConfig,
  validCategorySlugs: ReadonlySet<string>,
): AdminProductListConfig {
  if (!config.category || validCategorySlugs.has(config.category)) return config;
  return { ...config, category: "" };
}

export function getRelaxedAdminProductListConfig(
  config: AdminProductListConfig,
  product: { categorySlug: string; published: boolean; availability: ProductAvailability },
): { config: AdminProductListConfig; relaxed: Array<"category" | "status" | "availability"> } {
  const relaxed: Array<"category" | "status" | "availability"> = [];
  const next = { ...config };

  if (config.category && config.category !== product.categorySlug) {
    next.category = "";
    relaxed.push("category");
  }
  if (
    (config.status === "published" && !product.published) ||
    (config.status === "draft" && product.published)
  ) {
    next.status = "";
    relaxed.push("status");
  }
  if (config.availability && config.availability !== product.availability) {
    next.availability = "";
    relaxed.push("availability");
  }

  return { config: next, relaxed };
}

export function setAdminProductListConfigParams(params: URLSearchParams, config: AdminProductListConfig): void {
  for (const key of ["category", "status", "availability", "sort"] as const) params.delete(key);
  if (config.category) params.set("category", config.category);
  if (config.status) params.set("status", config.status);
  if (config.availability) params.set("availability", config.availability);
  if (config.sort !== "order") params.set("sort", config.sort);
}

export function buildAdminProductMutationRedirect(options: {
  config: AdminProductListConfig;
  page: number;
  flashAction: "created" | "updated";
  slug: string;
  photoErrorCount?: number;
  relaxed?: Array<"category" | "status" | "availability">;
}): string {
  const params = new URLSearchParams();
  const relaxed = options.relaxed ?? [];

  if (relaxed.length > 0) {
    params.set("view", "target");
    setAdminProductListConfigParams(params, options.config);
    params.set("relaxed", relaxed.join(","));
  }
  if (options.page > 1) params.set("page", String(options.page));
  params.set(options.flashAction, options.slug);
  if (options.photoErrorCount && options.photoErrorCount > 0) {
    params.set("photoError", String(options.photoErrorCount));
  }

  return `/admin/products?${params.toString()}`;
}

export async function buildAdminProductMutationRedirectFailSoft(
  options: Omit<Parameters<typeof buildAdminProductMutationRedirect>[0], "page">,
  findTargetPage: () => Promise<number | null>,
): Promise<{ href: string; lookupError: unknown | null }> {
  let page = 1;
  let lookupError: unknown | null = null;

  try {
    page = (await findTargetPage()) ?? 1;
  } catch (error) {
    // The mutation is already committed. Falling back to page 1 keeps the
    // successful save successful and avoids inviting a duplicate submission.
    lookupError = error;
  }

  return {
    href: buildAdminProductMutationRedirect({ ...options, page }),
    lookupError,
  };
}
