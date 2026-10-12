// Compatibility probe: does the CURRENT production application (the code on `main`, served by Vercel) still work against
// a database schema? It replays the database calls that code makes: the public readers (anon key) and the admin writes
// (service-role key). Run it after each migration is applied to a LOCAL database to see exactly which one breaks what.
// Usage: node scripts/dev/migration-compat.mjs [label]        (local Supabase must be running; uses `supabase status`)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const label = process.argv[2] ?? "";
const status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: true }));
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(status.API_URL)) throw new Error("local database only");
const ANON = status.ANON_KEY;
const SERVICE = status.SERVICE_ROLE_KEY;
const BASE = `${status.API_URL}/rest/v1`;

async function call(role, method, path, body, extra = {}) {
  const key = role === "anon" ? ANON : SERVICE;
  const response = await fetch(`${BASE}/${path}`, {
    method,
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "count=exact,return=representation", ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  const range = response.headers.get("content-range");
  return { ok: response.ok, status: response.status, json, count: range ? Number(range.split("/")[1]) : null, message: json?.message ?? json?.hint ?? (response.ok ? "" : text.slice(0, 120)) };
}
const get = (role, path) => call(role, "GET", path);
const rpc = (role, name, args) => call(role, "POST", `rpc/${name}`, args);

const IMG = 'product_images(url,"order",scale,thumbnail_url,gallery_url)';
const KEY_HASH = createHash("sha256").update("compat-probe").digest("hex");
const results = [];
async function check(group, name, fn) {
  try {
    const r = await fn();
    const failed = r === false || (typeof r === "object" && r !== null && "ok" in r && !r.ok);
    results.push({ group, name, ok: !failed, detail: failed ? `${r.status ?? ""} ${r.message ?? ""}`.trim() : "" });
  } catch (error) {
    results.push({ group, name, ok: false, detail: String(error.message ?? error).slice(0, 120) });
  }
}
const nonEmpty = (r, what) => (r.ok && Array.isArray(r.json) && r.json.length > 0 ? r : { ok: false, status: r.status, message: r.ok ? `${what}: empty result` : r.message });

// ---- public pages (anon key) ----
await check("public", "brands list", async () => nonEmpty(await get("anon", "brands?select=*&order=order"), "brands"));
await check("public", "categories list", async () => nonEmpty(await get("anon", "categories?select=*&order=order"), "categories"));
await check("public", "category types", async () => nonEmpty(await get("anon", "categories?select=slug,type"), "categories"));
await check("public", "subcategories", async () => nonEmpty(await get("anon", "subcategories?select=slug,name,image,intro"), "subcategories"));
await check("public", "category brands", async () => nonEmpty(await get("anon", "category_brands?select=logo_scale_override,brands(*)"), "category_brands"));
await check("public", "category/brand slugs", async () => nonEmpty(await get("anon", "category_brands?select=category_slug,brand_slug"), "category_brands"));
await check("public", "vehicle types", async () => nonEmpty(await get("anon", "vehicle_types?select=slug,name&order=order"), "vehicle_types"));
await check("public", "product cards (legacy select)", async () => nonEmpty(await get("anon", `products?select=slug,name,category_slug,short_description,article,subcategories(slug),${IMG},product_brands(brand_slug)&order=order&limit=24`), "products"));
const first = (await get("anon", "products?select=slug,category_slug&limit=1")).json?.[0];
await check("public", "product page", async () => {
  if (!first) return { ok: false, status: 0, message: "no products visible" };
  return nonEmpty(await get("anon", `products?select=slug,name,category_slug,short_description,description,article,meta_title,meta_description,subcategories(slug),${IMG},product_characteristics(attribute,value,"order"),product_brands(brands(slug,name,country,logo,logo_scale)),product_vehicle_types(vehicle_type_slug)&slug=eq.${first.slug}`), "product");
});
await check("public", "sitemap products", async () => nonEmpty(await get("anon", `products?select=slug,name,category_slug,short_description,article,updated_at,subcategories(slug),${IMG},product_brands(brand_slug)&order=slug&limit=1000`), "products"));
await check("public", "vehicle hotspots", async () => nonEmpty(await get("anon", `vehicle_hotspots?select=id,hotspot_number,label,x_pct,y_pct,vehicle_type_slug,products(slug,name,short_description,${IMG})&order=hotspot_number`), "hotspots"));
await check("public", "search: all products", async () => {
  const r = await rpc("anon", "search_catalog_products", { search_query: null, category_filter: null, subcategory_filter: null, brand_filter: null, vehicle_type_filter: null });
  return nonEmpty(r, "search");
});
await check("public", "search: by word", async () => {
  const r = await rpc("anon", "search_catalog_products", { search_query: "вал", category_filter: null, subcategory_filter: null, brand_filter: null, vehicle_type_filter: null });
  return r.ok ? r : r;
});
await check("public", "search: by category", async () => {
  const r = await rpc("anon", "search_catalog_products", { search_query: null, category_filter: first?.category_slug ?? "pto", subcategory_filter: null, brand_filter: null, vehicle_type_filter: null });
  return nonEmpty(r, "search");
});

// ---- admin writes and reads (service-role key) ----
const category = (await get("service", "categories?select=slug&limit=1")).json?.[0]?.slug;
let createdSlug = null;
let createdUpdatedAt = null;
await check("admin", "create product (rpc)", async () => {
  const r = await rpc("service", "create_product_with_relations", {
    p_slug_base: "compat-probe", p_name: "Compat probe", p_category_slug: category, p_subcategory_slug: null, p_short_description: "x",
    p_description: null, p_article: null, p_published: false, p_availability: "in_stock", p_meta_title: null, p_meta_description: null,
    p_characteristics: [], p_compatible_brands: [], p_vehicle_types: [],
  });
  const row = Array.isArray(r.json) ? r.json[0] : r.json;
  createdSlug = row?.out_slug ?? null;
  return r.ok && createdSlug ? r : { ok: false, status: r.status, message: r.message || "no slug returned" };
});
await check("admin", "update product (rpc)", async () => {
  if (!createdSlug) return { ok: false, status: 0, message: "skipped: no product" };
  createdUpdatedAt = (await get("service", `products?select=updated_at&slug=eq.${createdSlug}`)).json?.[0]?.updated_at;
  const r = await rpc("service", "update_product_with_relations", {
    p_slug: createdSlug, p_expected_updated_at: createdUpdatedAt, p_name: "Compat probe 2", p_category_slug: category, p_subcategory_slug: null,
    p_short_description: "y", p_description: null, p_article: null, p_published: false, p_availability: "in_stock", p_meta_title: null,
    p_meta_description: null, p_characteristics: [], p_compatible_brands: [], p_vehicle_types: [],
  });
  return r;
});
await check("admin", "reorder products (rpc)", async () => {
  const slugs = ((await get("service", "products?select=slug&order=order")).json ?? []).map((row) => row.slug);
  return rpc("service", "reorder_products", { ordered_slugs: slugs });
});
await check("admin", "reorder categories (rpc)", async () => {
  const slugs = ((await get("service", "categories?select=slug&order=order")).json ?? []).map((row) => row.slug);
  return rpc("service", "reorder_categories", { ordered_slugs: slugs });
});
await check("admin", "write straight to a table (trigger path)", async () => {
  const slug = (await get("service", "brands?select=slug&limit=1")).json?.[0]?.slug;
  return call("service", "PATCH", `brands?slug=eq.${slug}`, { name: (await get("service", `brands?select=name&slug=eq.${slug}`)).json?.[0]?.name });
});
await check("admin", "login rate limit (begin/finish)", async () => {
  const begin = await rpc("service", "begin_admin_auth_attempt", { p_key_hash: KEY_HASH, p_scope: "login", p_ttl_seconds: 30, p_max_concurrent: 5 });
  const row = Array.isArray(begin.json) ? begin.json[0] : begin.json;
  if (!begin.ok || !row?.out_reservation_id) return { ok: false, status: begin.status, message: begin.message || "no reservation" };
  return rpc("service", "finish_admin_auth_attempt", { p_reservation_id: row.out_reservation_id, p_password_is_valid: true });
});
await check("admin", "login attempt log (rpc)", async () => rpc("service", "register_admin_login_attempt", { attempt_key_hash: KEY_HASH, password_is_valid: true, attempt_scope: "login" }));
await check("admin", "read admin credentials", async () => get("service", "admin_credentials?select=session_version&limit=1"));
await check("admin", "read audit log", async () => get("service", "admin_audit_log?select=id&order=id.desc&limit=1"));
await check("admin", "photo upload slot (claim staging)", async () => {
  const draft = crypto.randomUUID();
  const r = await rpc("service", "claim_product_image_staging", { p_draft_id: draft, p_object_path: `compat/${draft}.webp`, p_content_type: "image/webp", p_byte_size: 1000, p_ttl_seconds: 600, p_max_files: 10 });
  await call("service", "DELETE", `product_image_staging?draft_id=eq.${draft}`);
  return r;
});
await check("admin", "hotspot assignments (rpc)", async () => {
  const spot = (await get("service", "vehicle_hotspots?select=id,product_id&product_id=not.is.null&limit=1")).json?.[0];
  if (!spot) return { ok: false, status: 0, message: "no hotspot with a product to test" };
  return rpc("service", "update_vehicle_hotspot_assignments", { assignment_updates: [{ hotspotId: spot.id, expectedProductId: spot.product_id, productId: spot.product_id }] });
});
await check("admin", "csv import batch (rpc)", async () => {
  const r = await rpc("service", "import_products_batch", { rows: [{ row_index: 1, article: "COMPAT-1", name: "Compat import", slug: "compat-import", category_slug: category, subcategory_id: null, short_description: "x", description: null, published: false, brand_slugs: [], vehicle_type_slugs: [], characteristics: [] }] });
  await call("service", "DELETE", "products?slug=eq.compat-import");
  return r;
});
await check("admin", "delete product", async () => (createdSlug ? call("service", "DELETE", `products?slug=eq.${createdSlug}`) : { ok: false, status: 0, message: "skipped: no product" }));

const pad = (text, n) => String(text).padEnd(n);
console.log(`\n== ${label || "compatibility of the current app with this schema"} ==`);
for (const group of ["public", "admin"]) {
  for (const r of results.filter((x) => x.group === group)) console.log(`${r.ok ? "PASS" : "FAIL"}  ${pad(group, 7)} ${pad(r.name, 42)} ${r.detail}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` · broken: ${failed.map((r) => r.name).join("; ")}` : ""}`);
