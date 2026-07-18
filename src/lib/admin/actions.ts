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

async function generateUniqueSlug(supabase: ReturnType<typeof createAdminClient>, name: string): Promise<string> {
  const base = slugify(name) || "product";
  let candidate = base;
  let suffix = 2;
  for (;;) {
    const { data } = await supabase.from("products").select("slug").eq("slug", candidate).maybeSingle();
    if (!data) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

export async function createProduct(formData: FormData): Promise<void> {
  await requireAdminSession();
  const fields = parseProductFormData(formData);
  const supabase = createAdminClient();

  const slug = await generateUniqueSlug(supabase, fields.slugSeed);
  const subcategoryId = await resolveSubcategoryId(supabase, fields.categorySlug, fields.subcategorySlug);

  const { data: maxOrderRow } = await supabase
    .from("products")
    .select("order")
    .order("order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (maxOrderRow?.order ?? -1) + 1;

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

  const { data: maxOrderRow } = await supabase
    .from("product_images")
    .select("order")
    .eq("product_id", productId)
    .order("order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (maxOrderRow?.order ?? -1) + 1;

  const { data: inserted, error: insertError } = await supabase
    .from("product_images")
    .insert({ product_id: productId, url: publicUrlData.publicUrl, order: nextOrder })
    .select("id, url, order")
    .single();
  if (insertError) throw insertError;

  revalidatePath("/admin/products");
  return inserted;
}

function extractStoragePath(publicUrl: string): string | null {
  const marker = "/product-images/";
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

  const storagePath = extractStoragePath(image.url);
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
