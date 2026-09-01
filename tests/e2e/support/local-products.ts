import { getLocalAdminClient } from "./local-supabase";

export const E2E_PRODUCT_PREFIX = "qa-e2e-";
const CATALOG_PAGE_SIZE = 24;

export type OwnedCatalogFixture = {
  categorySlug: string;
  productIds: string[];
  products: Array<{
    id: string;
    slug: string;
    name: string;
    metaTitle: string;
    metaDescription: string;
  }>;
  batchQuery: string;
};

export type OwnedCategoryFixture = {
  slug: string;
  name: string;
};

export type OwnedProductImage = {
  id: string;
  url: string;
  thumbnail_url: string | null;
  gallery_url: string | null;
};

function assertOwnedSlug(slug: string) {
  if (!slug.startsWith(E2E_PRODUCT_PREFIX)) {
    throw new Error(`Отказ очистки чужого fixture slug: ${slug}`);
  }
}

function ownedProductImageStoragePath(slug: string, publicUrl: string): string | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL не задан для local E2E.");

  let parsed: URL;
  try {
    parsed = new URL(publicUrl);
  } catch {
    return null;
  }
  if (parsed.origin !== new URL(supabaseUrl).origin) return null;

  const marker = "/storage/v1/object/public/product-images/";
  if (!parsed.pathname.startsWith(marker)) return null;
  const path = decodeURIComponent(parsed.pathname.slice(marker.length));
  return path.startsWith(`${slug}/`) ? path : null;
}

export async function cleanupOwnedProduct(slug: string): Promise<void> {
  assertOwnedSlug(slug);
  const supabase = getLocalAdminClient();
  const { data, error: lookupError } = await supabase.from("products").select("id").eq("slug", slug);
  if (lookupError) throw lookupError;

  const ownedIds = (data ?? []).map((row) => row.id);
  if (ownedIds.length === 0) return;

  const { data: images, error: imagesError } = await supabase
    .from("product_images")
    .select("url, thumbnail_url, gallery_url")
    .in("product_id", ownedIds);
  if (imagesError) throw imagesError;

  const { error: deleteError } = await supabase.from("products").delete().in("id", ownedIds);
  if (deleteError) throw deleteError;

  const storagePaths = [
    ...new Set(
      (images ?? []).flatMap((image) =>
        [image.url, image.thumbnail_url, image.gallery_url]
          .filter((url): url is string => Boolean(url))
          .map((url) => ownedProductImageStoragePath(slug, url))
          .filter((path): path is string => Boolean(path)),
      ),
    ),
  ];
  if (storagePaths.length > 0) {
    const { error: storageError } = await supabase.storage.from("product-images").remove(storagePaths);
    if (storageError) throw storageError;
  }
}

export async function expectOwnedProductAbsent(slug: string): Promise<boolean> {
  assertOwnedSlug(slug);
  const supabase = getLocalAdminClient();
  const { data, error } = await supabase.from("products").select("id").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data === null;
}

export async function createOwnedCategoryFixture(): Promise<OwnedCategoryFixture> {
  const supabase = getLocalAdminClient();
  const runId = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const fixture = {
    slug: `${E2E_PRODUCT_PREFIX}category-${runId}`,
    name: `QA E2E Category ${runId}`,
  };
  const { error } = await supabase.from("categories").insert({
    slug: fixture.slug,
    name: fixture.name,
    description: "Owned local Playwright fixture",
    icon: "hydraulic-pump",
    image: "/brand/ayprom-icon.svg",
    type: null,
    order: 1_000_000,
  });
  if (error) throw error;
  return fixture;
}

export async function cleanupOwnedCategory(fixture: OwnedCategoryFixture): Promise<void> {
  assertOwnedSlug(fixture.slug);
  const supabase = getLocalAdminClient();
  const { data, error: lookupError } = await supabase
    .from("categories")
    .select("slug")
    .eq("slug", fixture.slug)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!data) return;

  const { count, error: productLookupError } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("category_slug", fixture.slug);
  if (productLookupError) throw productLookupError;
  if (count) throw new Error(`Отказ очистки category fixture с оставшимися товарами: ${fixture.slug}`);

  const { error: deleteError } = await supabase.from("categories").delete().eq("slug", fixture.slug);
  if (deleteError) throw deleteError;
}

/**
 * Один товар напрямую в базе — для сценариев, где создание через форму не
 * является предметом теста и только замедляет прогон.
 */
export async function createOwnedProductFixture(categorySlug: string, name: string): Promise<string> {
  assertOwnedSlug(categorySlug);
  const supabase = getLocalAdminClient();
  const slug = `${E2E_PRODUCT_PREFIX}product-${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await supabase.from("products").insert({
    slug,
    name,
    category_slug: categorySlug,
    short_description: "Owned local Playwright fixture",
    published: false,
    availability: "in_stock",
    order: 1_000_000,
  });
  if (error) throw error;
  return slug;
}

/**
 * Имитирует правку товара другим администратором: двигает версию строки, не
 * меняя содержимого. Форма, открытая до этого момента, становится устаревшей —
 * ровно тот случай, который должна поймать проверка версии (QA-002).
 */
export async function touchOwnedProduct(slug: string): Promise<void> {
  assertOwnedSlug(slug);
  const supabase = getLocalAdminClient();
  const { error } = await supabase
    .from("products")
    .update({ updated_at: new Date().toISOString() })
    .eq("slug", slug);
  if (error) throw error;
}

/** Сколько фотографий действительно привязано к товару (QA-004). */
export async function countOwnedProductImages(slug: string): Promise<number> {
  assertOwnedSlug(slug);
  const supabase = getLocalAdminClient();
  const { data: product, error } = await supabase.from("products").select("id").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!product) return -1;

  const { count, error: countError } = await supabase
    .from("product_images")
    .select("id", { count: "exact", head: true })
    .eq("product_id", product.id);
  if (countError) throw countError;
  return count ?? 0;
}

export async function readOwnedProductImages(slug: string): Promise<OwnedProductImage[]> {
  assertOwnedSlug(slug);
  const supabase = getLocalAdminClient();
  const { data: product, error } = await supabase.from("products").select("id").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!product) return [];

  const { data, error: imageError } = await supabase
    .from("product_images")
    .select("id, url, thumbnail_url, gallery_url")
    .eq("product_id", product.id)
    .order("order")
    .order("id");
  if (imageError) throw imageError;
  return data ?? [];
}

export async function downloadOwnedProductImageObject(slug: string, publicUrl: string): Promise<Buffer | null> {
  assertOwnedSlug(slug);
  const path = ownedProductImageStoragePath(slug, publicUrl);
  if (!path) throw new Error(`URL изображения не принадлежит E2E-товару ${slug}.`);

  const { data, error } = await getLocalAdminClient().storage.from("product-images").download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** Текущее имя товара — чтобы доказать, что отклонённое сохранение ничего не изменило. */
export async function readOwnedProductName(slug: string): Promise<string | null> {
  assertOwnedSlug(slug);
  const supabase = getLocalAdminClient();
  const { data, error } = await supabase.from("products").select("name").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data?.name ?? null;
}

export async function createOwnedCatalogFixture(): Promise<OwnedCatalogFixture> {
  const supabase = getLocalAdminClient();
  const runId = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const categorySlug = `${E2E_PRODUCT_PREFIX}category-${runId}`;
  const batchQuery = `QAE2EBATCH${runId}`;
  const productCount = CATALOG_PAGE_SIZE + 1;

  const { error: categoryError } = await supabase.from("categories").insert({
    slug: categorySlug,
    name: `QA E2E Category ${runId}`,
    description: "Owned local Playwright fixture",
    icon: "hydraulic-pump",
    image: "/brand/ayprom-icon.svg",
    type: "subcategory",
    order: 1_000_000,
  });
  if (categoryError) throw categoryError;

  const rows = Array.from({ length: productCount }, (_, index) => {
    const position = String(index + 1).padStart(2, "0");
    return {
      slug: `${E2E_PRODUCT_PREFIX}product-${runId}-${position}`,
      name: `${batchQuery} product ${position}`,
      category_slug: categorySlug,
      short_description: "Owned local Playwright fixture",
      article: `${batchQuery}${position}`,
      published: true,
      availability: "in_stock",
      meta_title: `QA E2E Meta ${runId} ${position}`,
      meta_description: `QA E2E metadata fixture ${runId} ${position}`,
      order: 1_000_000 + index,
    };
  });

  const { data, error: productsError } = await supabase
    .from("products")
    .insert(rows)
    .select("id, slug, name, meta_title, meta_description");
  if (productsError) {
    await supabase.from("categories").delete().eq("slug", categorySlug);
    throw productsError;
  }

  const insertedProducts = [...data].sort((left, right) => left.slug.localeCompare(right.slug));

  return {
    categorySlug,
    productIds: insertedProducts.map((row) => row.id),
    products: insertedProducts.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      metaTitle: row.meta_title,
      metaDescription: row.meta_description,
    })),
    batchQuery,
  };
}

export async function cleanupOwnedCatalogFixture(fixture: OwnedCatalogFixture): Promise<void> {
  assertOwnedSlug(fixture.categorySlug);
  const supabase = getLocalAdminClient();

  if (fixture.productIds.length > 0) {
    const { data, error: lookupError } = await supabase
      .from("products")
      .select("id, slug")
      .in("id", fixture.productIds);
    if (lookupError) throw lookupError;
    for (const row of data ?? []) assertOwnedSlug(row.slug);

    const { error: productsError } = await supabase.from("products").delete().in("id", fixture.productIds);
    if (productsError) throw productsError;
  }

  const { error: categoryError } = await supabase.from("categories").delete().eq("slug", fixture.categorySlug);
  if (categoryError) throw categoryError;
}
