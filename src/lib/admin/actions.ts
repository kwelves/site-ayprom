"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  createSessionToken,
  verifySessionToken,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_SECONDS,
} from "@/lib/admin/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/admin/slugify";
import type { CategoryIcon } from "@/types/catalog";

export async function login(formData: FormData): Promise<void> {
  const password = formData.get("password");

  if (typeof password !== "string" || password !== process.env.ADMIN_PASSWORD) {
    redirect("/admin/login?error=1");
  }

  const token = await createSessionToken();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });

  redirect("/admin/products");
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  redirect("/admin/login");
}

// Every product-mutating Server Action (task 14) calls this first — defense
// in depth, since Server Actions are callable directly and don't pass
// through middleware.
export async function requireAdminSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!(await verifySessionToken(token))) {
    redirect("/admin/login");
  }
}

interface ProductFormFields {
  name: string;
  slugSeed: string;
  categorySlug: string;
  subcategorySlug: string | null;
  compatibleBrands: string[];
  shortDescription: string;
  description: string | null;
  article: string | null;
  published: boolean;
  characteristics: { attribute: string; value: string }[];
}

// Characteristics are edited entirely as client-side form state (add/remove/
// reorder rows) and only hit the database when the whole product form is
// submitted — unlike images, which persist immediately on upload since a
// File can't be carried across multiple saves. Serialized as two parallel
// arrays of same-name fields; FormData preserves DOM order, so index i of
// each array is one row.
function parseProductFormData(formData: FormData): ProductFormFields {
  const name = String(formData.get("name") ?? "").trim();
  // On create, an editable slug field lets the admin override the
  // auto-generated one before first save; ignored on edit (no such field in
  // the form there — slug is read-only to avoid breaking existing links).
  const slugSeed = String(formData.get("slug") ?? "").trim() || name;
  const categorySlug = String(formData.get("categorySlug") ?? "").trim();
  const subcategorySlug = String(formData.get("subcategorySlug") ?? "").trim() || null;
  const compatibleBrands = formData.getAll("compatibleBrands").map(String);
  const shortDescription = String(formData.get("shortDescription") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const article = String(formData.get("article") ?? "").trim() || null;
  const published = formData.get("published") === "on";
  const attributes = formData.getAll("characteristicAttribute").map(String);
  const values = formData.getAll("characteristicValue").map(String);
  const characteristics = attributes
    .map((attribute, i) => ({ attribute: attribute.trim(), value: (values[i] ?? "").trim() }))
    .filter((c) => c.attribute && c.value);

  if (!name || !categorySlug || !shortDescription) {
    throw new Error("Заполните обязательные поля: название, категория, краткое описание.");
  }

  return {
    name,
    slugSeed,
    categorySlug,
    subcategorySlug,
    compatibleBrands,
    shortDescription,
    description,
    article,
    published,
    characteristics,
  };
}

async function resolveSubcategoryId(
  supabase: ReturnType<typeof createAdminClient>,
  categorySlug: string,
  subcategorySlug: string | null
): Promise<string | null> {
  if (!subcategorySlug) return null;
  const { data, error } = await supabase
    .from("subcategories")
    .select("id")
    .eq("category_slug", categorySlug)
    .eq("slug", subcategorySlug)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

// Shared by every create action's "append at the end" ordering: the next
// row's order is one past the current max (or 0 for the first row).
// `filters` scopes the max lookup to tables where order is per-parent
// (subcategories, category_brands) rather than global.
async function getNextOrder(
  supabase: ReturnType<typeof createAdminClient>,
  table: "products" | "brands" | "categories" | "subcategories" | "category_brands" | "product_images",
  filters?: Record<string, string>
): Promise<number> {
  let query = supabase.from(table).select("order").order("order", { ascending: false }).limit(1);
  for (const [column, value] of Object.entries(filters ?? {})) {
    query = query.eq(column, value);
  }
  const { data } = await query.maybeSingle();
  return (data?.order ?? -1) + 1;
}

async function generateUniqueSlug(
  supabase: ReturnType<typeof createAdminClient>,
  table: "products" | "brands" | "categories",
  seed: string,
  fallback: string
): Promise<string> {
  const base = slugify(seed) || fallback;
  let candidate = base;
  let suffix = 2;
  for (;;) {
    const { data } = await supabase.from(table).select("slug").eq("slug", candidate).maybeSingle();
    if (!data) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

export async function createProduct(formData: FormData): Promise<void> {
  await requireAdminSession();
  const fields = parseProductFormData(formData);
  const supabase = createAdminClient();

  const slug = await generateUniqueSlug(supabase, "products", fields.slugSeed, "product");
  const subcategoryId = await resolveSubcategoryId(supabase, fields.categorySlug, fields.subcategorySlug);
  const nextOrder = await getNextOrder(supabase, "products");

  const { data: product, error } = await supabase
    .from("products")
    .insert({
      slug,
      name: fields.name,
      category_slug: fields.categorySlug,
      subcategory_id: subcategoryId,
      short_description: fields.shortDescription,
      description: fields.description,
      article: fields.article,
      published: fields.published,
      order: nextOrder,
    })
    .select("id")
    .single();
  if (error) throw error;

  if (fields.characteristics.length > 0) {
    const { error: charError } = await supabase
      .from("product_characteristics")
      .insert(fields.characteristics.map((c, i) => ({ product_id: product.id, attribute: c.attribute, value: c.value, order: i })));
    if (charError) throw charError;
  }

  if (fields.compatibleBrands.length > 0) {
    const { error: brandError } = await supabase
      .from("product_brands")
      .insert(fields.compatibleBrands.map((brandSlug) => ({ product_id: product.id, brand_slug: brandSlug })));
    if (brandError) throw brandError;
  }

  revalidatePath("/admin/products");
  redirect(`/admin/products/${slug}/edit`);
}

export async function updateProduct(slug: string, formData: FormData): Promise<void> {
  await requireAdminSession();
  const fields = parseProductFormData(formData);
  const supabase = createAdminClient();

  const { data: existing, error: findError } = await supabase
    .from("products")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (findError) throw findError;
  if (!existing) throw new Error("Товар не найден.");

  const subcategoryId = await resolveSubcategoryId(supabase, fields.categorySlug, fields.subcategorySlug);

  const { error: updateError } = await supabase
    .from("products")
    .update({
      name: fields.name,
      category_slug: fields.categorySlug,
      subcategory_id: subcategoryId,
      short_description: fields.shortDescription,
      description: fields.description,
      article: fields.article,
      published: fields.published,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);
  if (updateError) throw updateError;

  // Delete+insert instead of diffing — simpler and reliable at this data
  // volume, and both child tables only ever reflect the form's current state.
  const { error: deleteCharError } = await supabase.from("product_characteristics").delete().eq("product_id", existing.id);
  if (deleteCharError) throw deleteCharError;
  if (fields.characteristics.length > 0) {
    const { error: charError } = await supabase
      .from("product_characteristics")
      .insert(fields.characteristics.map((c, i) => ({ product_id: existing.id, attribute: c.attribute, value: c.value, order: i })));
    if (charError) throw charError;
  }

  const { error: deleteBrandError } = await supabase.from("product_brands").delete().eq("product_id", existing.id);
  if (deleteBrandError) throw deleteBrandError;
  if (fields.compatibleBrands.length > 0) {
    const { error: brandError } = await supabase
      .from("product_brands")
      .insert(fields.compatibleBrands.map((brandSlug) => ({ product_id: existing.id, brand_slug: brandSlug })));
    if (brandError) throw brandError;
  }

  revalidatePath(`/admin/products/${slug}/edit`);
  revalidatePath("/admin/products");
}

export async function deleteProduct(slug: string): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();

  // Storage isn't covered by the DB cascade — every uploaded photo lives
  // under a folder named after the product's slug, so listing and removing
  // that folder cleans them up before the row (and its slug) disappears.
  const { data: files } = await supabase.storage.from("product-images").list(slug);
  if (files && files.length > 0) {
    await supabase.storage.from("product-images").remove(files.map((file) => `${slug}/${file.name}`));
  }

  // Cascades clean up product_images/product_characteristics/product_brands.
  const { error } = await supabase.from("products").delete().eq("slug", slug);
  if (error) throw error;
  revalidatePath("/admin/products");
  redirect("/admin/products");
}

export async function reorderProducts(orderedSlugs: string[]): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();
  await Promise.all(orderedSlugs.map((slug, index) => supabase.from("products").update({ order: index }).eq("slug", slug)));
  revalidatePath("/admin/products");
}

interface UploadedImage {
  id: string;
  url: string;
  order: number;
}

// Returns the inserted row directly rather than relying on revalidatePath +
// router.refresh() — ProductForm's local `images` state is seeded from
// `product.images` only once, on mount (so an in-progress edit to other
// fields isn't wiped out by a refetch); a refresh-driven prop update would
// never reach it. The caller appends this return value to state itself.
export async function uploadProductImage(productId: string, formData: FormData): Promise<UploadedImage | null> {
  await requireAdminSession();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return null;

  const supabase = createAdminClient();
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("slug")
    .eq("id", productId)
    .maybeSingle();
  if (productError) throw productError;
  if (!product) return null;

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${product.slug}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from("product-images").upload(path, file);
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from("product-images").getPublicUrl(path);
  const nextOrder = await getNextOrder(supabase, "product_images", { product_id: productId });

  const { data: inserted, error: insertError } = await supabase
    .from("product_images")
    .insert({ product_id: productId, url: publicUrlData.publicUrl, order: nextOrder })
    .select("id, url, order")
    .single();
  if (insertError) throw insertError;

  revalidatePath("/admin/products");
  return inserted;
}

function extractStoragePath(publicUrl: string, bucket: string): string | null {
  const marker = `/${bucket}/`;
  const index = publicUrl.indexOf(marker);
  return index === -1 ? null : publicUrl.slice(index + marker.length);
}

export async function deleteProductImage(imageId: string): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();

  const { data: image, error: findError } = await supabase
    .from("product_images")
    .select("url, products(slug)")
    .eq("id", imageId)
    .maybeSingle<{ url: string; products: { slug: string } }>();
  if (findError) throw findError;
  if (!image) return;

  const storagePath = extractStoragePath(image.url, "product-images");
  if (storagePath) {
    await supabase.storage.from("product-images").remove([storagePath]);
  }

  const { error: deleteError } = await supabase.from("product_images").delete().eq("id", imageId);
  if (deleteError) throw deleteError;

  revalidatePath(`/admin/products/${image.products.slug}/edit`);
}

export async function reorderProductImages(productSlug: string, orderedImageIds: string[]): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();
  await Promise.all(orderedImageIds.map((id, index) => supabase.from("product_images").update({ order: index }).eq("id", id)));
  revalidatePath(`/admin/products/${productSlug}/edit`);
}

interface BrandFormFields {
  name: string;
  slugSeed: string;
  country: string;
  logoScale: number | null;
}

function parseBrandFormData(formData: FormData): BrandFormFields {
  const name = String(formData.get("name") ?? "").trim();
  const slugSeed = String(formData.get("slug") ?? "").trim() || name;
  const country = String(formData.get("country") ?? "").trim();
  const logoScaleRaw = String(formData.get("logoScale") ?? "").trim();
  const parsedLogoScale = logoScaleRaw ? Number(logoScaleRaw) : null;

  if (!name || !country) {
    throw new Error("Заполните обязательные поля: название, страна.");
  }

  return { name, slugSeed, country, logoScale: Number.isFinite(parsedLogoScale) ? parsedLogoScale : null };
}

async function uploadBrandLogo(
  supabase: ReturnType<typeof createAdminClient>,
  brandSlug: string,
  file: File
): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "svg";
  const path = `${brandSlug}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("brand-logos").upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from("brand-logos").getPublicUrl(path);
  return data.publicUrl;
}

// The logo is required on create (Brand.logo is non-optional — every card
// on the site renders it unconditionally), so unlike products it has to be
// uploaded within the same submission as the rest of the row instead of
// after the fact.
export async function createBrand(formData: FormData): Promise<void> {
  await requireAdminSession();
  const fields = parseBrandFormData(formData);
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Логотип обязателен.");
  }

  const supabase = createAdminClient();
  const slug = await generateUniqueSlug(supabase, "brands", fields.slugSeed, "brand");
  const logoUrl = await uploadBrandLogo(supabase, slug, file);
  const nextOrder = await getNextOrder(supabase, "brands");

  const { error } = await supabase.from("brands").insert({
    slug,
    name: fields.name,
    country: fields.country,
    logo: logoUrl,
    logo_scale: fields.logoScale,
    order: nextOrder,
  });
  if (error) throw error;

  revalidatePath("/admin/brands");
  redirect("/admin/brands");
}

// Text fields only — logo replacement is a separate immediate action
// (replaceBrandLogo) so its result can be pushed straight into BrandForm's
// local state, the same fix applied to product photo uploads (see
// uploadProductImage's comment): a `<form action>` Server Action's return
// value isn't visible to the component without useActionState, and this
// form doesn't need that complexity for its own text fields.
export async function updateBrand(slug: string, formData: FormData): Promise<void> {
  await requireAdminSession();
  const fields = parseBrandFormData(formData);
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("brands")
    .update({ name: fields.name, country: fields.country, logo_scale: fields.logoScale })
    .eq("slug", slug);
  if (error) throw error;

  revalidatePath("/admin/brands");
  revalidatePath(`/admin/brands/${slug}/edit`);
}

export async function replaceBrandLogo(slug: string, formData: FormData): Promise<string | null> {
  await requireAdminSession();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return null;

  const supabase = createAdminClient();
  const { data: existing } = await supabase.from("brands").select("logo").eq("slug", slug).maybeSingle();

  const newLogoUrl = await uploadBrandLogo(supabase, slug, file);

  const { error } = await supabase.from("brands").update({ logo: newLogoUrl }).eq("slug", slug);
  if (error) throw error;

  if (existing?.logo) {
    const oldPath = extractStoragePath(existing.logo, "brand-logos");
    if (oldPath) await supabase.storage.from("brand-logos").remove([oldPath]);
  }

  revalidatePath("/admin/brands");
  return newLogoUrl;
}

export async function deleteBrand(slug: string): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();

  const { data: brand } = await supabase.from("brands").select("logo").eq("slug", slug).maybeSingle();
  if (brand?.logo) {
    const path = extractStoragePath(brand.logo, "brand-logos");
    if (path) await supabase.storage.from("brand-logos").remove([path]);
  }

  // Cascades clean up product_brands/category_brands associations — the
  // BrandsList UI warns with usage counts before calling this.
  const { error } = await supabase.from("brands").delete().eq("slug", slug);
  if (error) throw error;

  revalidatePath("/admin/brands");
  redirect("/admin/brands");
}

export async function reorderBrands(orderedSlugs: string[]): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();
  await Promise.all(orderedSlugs.map((slug, index) => supabase.from("brands").update({ order: index }).eq("slug", slug)));
  revalidatePath("/admin/brands");
}

const CATEGORY_ICONS: CategoryIcon[] = ["hydraulic-pump", "pto", "pto-shaft", "tank"];

interface CategoryFormFields {
  name: string;
  slugSeed: string;
  description: string;
  icon: CategoryIcon;
  type: "subcategory" | "brand";
  intro: string | null;
}

function parseCategoryFormData(formData: FormData): CategoryFormFields {
  const name = String(formData.get("name") ?? "").trim();
  const slugSeed = String(formData.get("slug") ?? "").trim() || name;
  const description = String(formData.get("description") ?? "").trim();
  const iconRaw = String(formData.get("icon") ?? "");
  const icon = CATEGORY_ICONS.includes(iconRaw as CategoryIcon) ? (iconRaw as CategoryIcon) : CATEGORY_ICONS[0];
  const type = formData.get("type") === "brand" ? "brand" : "subcategory";
  const intro = String(formData.get("intro") ?? "").trim() || null;

  if (!name || !description) {
    throw new Error("Заполните обязательные поля: название, описание.");
  }

  return { name, slugSeed, description, icon, type, intro };
}

async function uploadCategoryImage(
  supabase: ReturnType<typeof createAdminClient>,
  pathPrefix: string,
  file: File
): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${pathPrefix}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("category-images").upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from("category-images").getPublicUrl(path);
  return data.publicUrl;
}

// `type` is required on create only — like brand.logo, the site can't
// render a category without it. It's deliberately absent from
// updateCategory below: changing it on an existing category would orphan
// whichever child rows (subcategories vs. category_brands) belong to the
// type it's leaving.
export async function createCategory(formData: FormData): Promise<void> {
  await requireAdminSession();
  const fields = parseCategoryFormData(formData);
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Изображение обязательно.");
  }

  const supabase = createAdminClient();
  const slug = await generateUniqueSlug(supabase, "categories", fields.slugSeed, "category");
  const imageUrl = await uploadCategoryImage(supabase, slug, file);
  const nextOrder = await getNextOrder(supabase, "categories");

  const { error } = await supabase.from("categories").insert({
    slug,
    name: fields.name,
    description: fields.description,
    icon: fields.icon,
    image: imageUrl,
    intro: fields.intro,
    type: fields.type,
    order: nextOrder,
  });
  if (error) throw error;

  revalidatePath("/admin/categories");
  redirect(`/admin/categories/${slug}/edit`);
}

// Text fields only, same reasoning as updateBrand — image replacement is
// its own immediate action (replaceCategoryImage) so the result can be
// pushed straight into CategoryForm's local state. `type` is never updated
// here (see createCategory's comment) and neither is `slug` (locked after
// create, same as products/brands, to avoid breaking existing links).
export async function updateCategory(slug: string, formData: FormData): Promise<void> {
  await requireAdminSession();
  const fields = parseCategoryFormData(formData);
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("categories")
    .update({ name: fields.name, description: fields.description, icon: fields.icon, intro: fields.intro })
    .eq("slug", slug);
  if (error) throw error;

  revalidatePath("/admin/categories");
  revalidatePath(`/admin/categories/${slug}/edit`);
}

export async function replaceCategoryImage(slug: string, formData: FormData): Promise<string | null> {
  await requireAdminSession();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return null;

  const supabase = createAdminClient();
  const { data: existing } = await supabase.from("categories").select("image").eq("slug", slug).maybeSingle();

  const newImageUrl = await uploadCategoryImage(supabase, slug, file);

  const { error } = await supabase.from("categories").update({ image: newImageUrl }).eq("slug", slug);
  if (error) throw error;

  if (existing?.image) {
    const oldPath = extractStoragePath(existing.image, "category-images");
    if (oldPath) await supabase.storage.from("category-images").remove([oldPath]);
  }

  revalidatePath("/admin/categories");
  return newImageUrl;
}

export async function deleteCategory(slug: string): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();

  const { data: files } = await supabase.storage.from("category-images").list(slug);
  if (files && files.length > 0) {
    await supabase.storage.from("category-images").remove(files.map((file) => `${slug}/${file.name}`));
  }

  // Subcategory images live in their own sub-{id} folders, not nested under
  // this category's — the DB cascade below clears subcategory rows but
  // wouldn't reach their Storage files, so remove those folders first.
  const { data: subcategories } = await supabase.from("subcategories").select("id").eq("category_slug", slug);
  for (const sub of subcategories ?? []) {
    const { data: subFiles } = await supabase.storage.from("category-images").list(`sub-${sub.id}`);
    if (subFiles && subFiles.length > 0) {
      await supabase.storage.from("category-images").remove(subFiles.map((file) => `sub-${sub.id}/${file.name}`));
    }
  }

  // Cascades clean up subcategories/category_brands; products.category_slug
  // has no cascade, so this throws (FK violation) if any product still
  // references this category — CategoriesList checks productCount before
  // calling this to avoid surfacing that raw error.
  const { error } = await supabase.from("categories").delete().eq("slug", slug);
  if (error) throw error;

  revalidatePath("/admin/categories");
  redirect("/admin/categories");
}

export async function reorderCategories(orderedSlugs: string[]): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();
  await Promise.all(
    orderedSlugs.map((slug, index) => supabase.from("categories").update({ order: index }).eq("slug", slug))
  );
  revalidatePath("/admin/categories");
}

interface SubcategoryFormFields {
  name: string;
  slugSeed: string;
  intro: string | null;
}

function parseSubcategoryFormData(formData: FormData): SubcategoryFormFields {
  const name = String(formData.get("name") ?? "").trim();
  const slugSeed = String(formData.get("slug") ?? "").trim() || name;
  const intro = String(formData.get("intro") ?? "").trim() || null;

  if (!name) {
    throw new Error("Заполните обязательное поле: название.");
  }

  return { name, slugSeed, intro };
}

// Subcategory slugs are only unique within their category (unique(category_slug, slug)
// in the schema, not a standalone primary key like products/brands/categories), so
// this checks scoped to categorySlug instead of reusing generateUniqueSlug.
async function generateUniqueSubcategorySlug(
  supabase: ReturnType<typeof createAdminClient>,
  categorySlug: string,
  seed: string
): Promise<string> {
  const base = slugify(seed) || "subcategory";
  let candidate = base;
  let suffix = 2;
  for (;;) {
    const { data } = await supabase
      .from("subcategories")
      .select("slug")
      .eq("category_slug", categorySlug)
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

// The id is generated here (not left to the DB default) so the Storage path
// for the required image upload can be built before the row exists — same
// reasoning as brands, just one step earlier since subcategories don't use
// their slug as the Storage folder name (slugs collide across categories).
export async function createSubcategory(categorySlug: string, formData: FormData): Promise<void> {
  await requireAdminSession();
  const fields = parseSubcategoryFormData(formData);
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Изображение обязательно.");
  }

  const supabase = createAdminClient();
  const slug = await generateUniqueSubcategorySlug(supabase, categorySlug, fields.slugSeed);
  const id = crypto.randomUUID();
  const imageUrl = await uploadCategoryImage(supabase, `sub-${id}`, file);
  const nextOrder = await getNextOrder(supabase, "subcategories", { category_slug: categorySlug });

  const { error } = await supabase.from("subcategories").insert({
    id,
    category_slug: categorySlug,
    slug,
    name: fields.name,
    image: imageUrl,
    intro: fields.intro,
    order: nextOrder,
  });
  if (error) throw error;

  revalidatePath(`/admin/categories/${categorySlug}/subcategories`);
  redirect(`/admin/categories/${categorySlug}/subcategories/${slug}/edit`);
}

export async function updateSubcategory(categorySlug: string, subSlug: string, formData: FormData): Promise<void> {
  await requireAdminSession();
  const fields = parseSubcategoryFormData(formData);
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("subcategories")
    .update({ name: fields.name, intro: fields.intro })
    .eq("category_slug", categorySlug)
    .eq("slug", subSlug);
  if (error) throw error;

  revalidatePath(`/admin/categories/${categorySlug}/subcategories`);
  revalidatePath(`/admin/categories/${categorySlug}/subcategories/${subSlug}/edit`);
}

export async function replaceSubcategoryImage(subcategoryId: string, formData: FormData): Promise<string | null> {
  await requireAdminSession();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return null;

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("subcategories")
    .select("image, category_slug")
    .eq("id", subcategoryId)
    .maybeSingle();
  if (!existing) return null;

  const newImageUrl = await uploadCategoryImage(supabase, `sub-${subcategoryId}`, file);

  const { error } = await supabase.from("subcategories").update({ image: newImageUrl }).eq("id", subcategoryId);
  if (error) throw error;

  if (existing.image) {
    const oldPath = extractStoragePath(existing.image, "category-images");
    if (oldPath) await supabase.storage.from("category-images").remove([oldPath]);
  }

  revalidatePath(`/admin/categories/${existing.category_slug}/subcategories`);
  return newImageUrl;
}

export async function deleteSubcategory(subcategoryId: string): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("subcategories")
    .select("category_slug")
    .eq("id", subcategoryId)
    .maybeSingle();
  if (!existing) return;

  const { data: files } = await supabase.storage.from("category-images").list(`sub-${subcategoryId}`);
  if (files && files.length > 0) {
    await supabase.storage.from("category-images").remove(files.map((file) => `sub-${subcategoryId}/${file.name}`));
  }

  // products.subcategory_id has no cascade, so this throws (FK violation) if
  // any product still references it — SubcategoriesList checks productCount
  // before calling this to avoid surfacing that raw error.
  const { error } = await supabase.from("subcategories").delete().eq("id", subcategoryId);
  if (error) throw error;

  revalidatePath(`/admin/categories/${existing.category_slug}/subcategories`);
  redirect(`/admin/categories/${existing.category_slug}/subcategories`);
}

export async function reorderSubcategories(categorySlug: string, orderedIds: string[]): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();
  await Promise.all(orderedIds.map((id, index) => supabase.from("subcategories").update({ order: index }).eq("id", id)));
  revalidatePath(`/admin/categories/${categorySlug}/subcategories`);
}

export async function addCategoryBrand(categorySlug: string, brandSlug: string): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();
  const nextOrder = await getNextOrder(supabase, "category_brands", { category_slug: categorySlug });

  const { error } = await supabase
    .from("category_brands")
    .insert({ category_slug: categorySlug, brand_slug: brandSlug, order: nextOrder });
  if (error) throw error;

  revalidatePath(`/admin/categories/${categorySlug}/category-brands`);
}

export async function removeCategoryBrand(categorySlug: string, brandSlug: string): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("category_brands")
    .delete()
    .eq("category_slug", categorySlug)
    .eq("brand_slug", brandSlug);
  if (error) throw error;
  revalidatePath(`/admin/categories/${categorySlug}/category-brands`);
}

export async function updateCategoryBrandOverride(
  categorySlug: string,
  brandSlug: string,
  logoScaleOverride: number | null
): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("category_brands")
    .update({ logo_scale_override: logoScaleOverride })
    .eq("category_slug", categorySlug)
    .eq("brand_slug", brandSlug);
  if (error) throw error;
  revalidatePath(`/admin/categories/${categorySlug}/category-brands`);
}

export async function reorderCategoryBrands(categorySlug: string, orderedBrandSlugs: string[]): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();
  await Promise.all(
    orderedBrandSlugs.map((brandSlug, index) =>
      supabase.from("category_brands").update({ order: index }).eq("category_slug", categorySlug).eq("brand_slug", brandSlug)
    )
  );
  revalidatePath(`/admin/categories/${categorySlug}/category-brands`);
}
