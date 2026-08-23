import {
  ADMIN_PRODUCT_LIST_CONFIG_COOKIE,
  ADMIN_PRODUCT_LIST_CONFIG_COOKIE_MAX_AGE,
  parseAdminProductListConfigCookie,
  serializeAdminProductListConfigCookie,
  type AdminProductListConfig,
} from "@/lib/admin/product-list-config";

export function parseAdminProductListConfigDocumentCookie(
  documentCookie: string,
): AdminProductListConfig | null {
  const prefix = `${ADMIN_PRODUCT_LIST_CONFIG_COOKIE}=`;
  const storedValue = documentCookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);

  return parseAdminProductListConfigCookie(storedValue);
}

export function saveAdminProductListConfigCookie(config: AdminProductListConfig): void {
  document.cookie = `${ADMIN_PRODUCT_LIST_CONFIG_COOKIE}=${serializeAdminProductListConfigCookie(config)}; path=/admin; max-age=${ADMIN_PRODUCT_LIST_CONFIG_COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function clearAdminProductListConfigCookie(): void {
  document.cookie = `${ADMIN_PRODUCT_LIST_CONFIG_COOKIE}=; path=/admin; max-age=0; SameSite=Lax`;
}
