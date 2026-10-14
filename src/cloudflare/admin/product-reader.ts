import { getAdminProductQueryPlan } from "@/lib/admin/product-list-query-plan";
import { ADMIN_PAGE_SIZE } from "@/lib/admin/pagination";
import { adminReadPage, type AdminProductReader, type AdminReadProduct } from "./products";

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1_048_576) { await reader.cancel(); throw new Error(); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}

function product(value: unknown): AdminReadProduct {
  if (!value || typeof value !== "object") throw new Error();
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.slug !== "string" || typeof row.name !== "string"
    || (row.article !== null && typeof row.article !== "string") || typeof row.published !== "boolean") throw new Error();
  return { id: row.id, slug: row.slug, name: row.name, article: row.article, published: row.published };
}

// Private read-only adapter. The handler must validate the session before calling it.
export function createAdminProductReader(
  bindings: { SUPABASE_URL: string; ADMIN_SUPABASE_KEY: string }, fetcher: typeof fetch = fetch,
): AdminProductReader {
  return async (query) => {
    let stage = "request";
    try {
      if (!Number.isInteger(query.page) || query.page < 1 || query.page > 100_000 || query.q.length > 200) throw new Error();
      const url = new URL(bindings.SUPABASE_URL);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
      url.pathname = "/rest/v1/products"; url.search = ""; url.hash = "";
      const plan = getAdminProductQueryPlan({ q: query.q });
      const offset = (query.page - 1) * ADMIN_PAGE_SIZE;
      url.searchParams.set("select", "id,slug,name,article,published");
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("limit", String(ADMIN_PAGE_SIZE));
      url.searchParams.set("order", plan.order.map((order) => `${order.column}.${order.ascending ? "asc" : "desc"}`).join(","));
      if (plan.searchExpression) url.searchParams.set("or", `(${plan.searchExpression})`);
      const key = bindings.ADMIN_SUPABASE_KEY.trim();
      if (!key) throw new Error();
      const headers = new Headers({ apikey: key, prefer: "count=exact" });
      if (key.startsWith("eyJ")) headers.set("authorization", `Bearer ${key}`);
      stage = "fetch";
      // The pinned workerd rejects redirect:"error". Manual + status validation
      // also refuses redirects without forwarding private headers elsewhere.
      const response = await fetcher(url, { method: "GET", headers, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(10_000) });
      stage = "count";
      const range = response.headers.get("content-range")?.match(/^(?:\d+-\d+|\*)\/(\d+)$/);
      const count = range ? Number(range[1]) : NaN;
      if (!Number.isSafeInteger(count) || count < 0) throw new Error();
      if (response.status === 416 && offset >= count) {
        await response.body?.cancel();
        return adminReadPage([], count, query.page);
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(); }
      stage = "decode";
      const rows = await boundedJson(response);
      stage = "rows";
      if (!Array.isArray(rows) || rows.length > ADMIN_PAGE_SIZE
        || (rows.length > 0 && offset + rows.length > count)
        || (rows.length === 0 && offset < count)) throw new Error();
      return adminReadPage(rows.map(product), count, query.page);
    } catch {
      console.error(JSON.stringify({ code: "admin_products_unavailable", stage }));
      throw new Error("Admin products unavailable");
    }
  };
}
