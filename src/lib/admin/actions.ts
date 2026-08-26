"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { refresh, revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import {
  createSessionToken,
  getSessionPayload,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_SECONDS,
} from "@/lib/admin/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/admin/slugify";
import {
  AdminLoginProtectionUnavailableError,
  registerLoginAttempt,
} from "@/lib/admin/login-rate-limit";
import {
  AdminCredentialConflictError,
  getAdminCredentialVersion,
  getAdminCredentialState,
  replaceAdminPasswordHash,
  verifyAdminPassword,
} from "@/lib/admin/credentials";
import {
  constantTimePasswordEqual,
  hashAdminPassword,
  validateNewAdminPassword,
} from "@/lib/admin/password-credential";
import { MAX_PRODUCT_IMAGES, validateProductImage } from "@/lib/admin/image-validation";
import { normalizeVisualScale } from "@/lib/admin/visual-scale";
import { toProductRpcError, type ProductRpcErrorLike } from "@/lib/admin/product-rpc-error";
import { convertBufferToWebp, enhanceProductPhotoBuffer } from "@/lib/admin/enhance-product-photo";
import {
  DEFAULT_PRODUCT_PHOTO_MODE,
  isProductPhotoMode,
  usesScriptProcessing,
  usesWebpOutput,
  type ProductPhotoMode,
} from "@/lib/admin/product-photo-mode";
import type { CategoryIcon } from "@/types/catalog";
import { getAdminProductTargetPage, type AdminAvailableProduct } from "@/lib/admin/queries";
import {
  ADMIN_PRODUCT_LIST_CONFIG_COOKIE,
  DEFAULT_ADMIN_PRODUCT_LIST_CONFIG,
  buildAdminProductMutationRedirectFailSoft,
  getRelaxedAdminProductListConfig,
  parseAdminProductListConfigCookie,
  type AdminProductListConfig,
} from "@/lib/admin/product-list-config";
import {
  DEFAULT_PRODUCT_AVAILABILITY,
  isProductAvailability,
  type ProductAvailability,
} from "@/lib/admin/product-availability";
import {
  buildBulkProductUpdateFields,
  normalizeBulkProductSlugs,
  type BulkProductPatch,
} from "@/lib/admin/bulk-product-update";
import { normalizeHotspotProductSearchQuery, selectAvailableHotspotProducts } from "@/lib/admin/hotspot-product-search";
import {
  HOTSPOTS_PER_VEHICLE,
  parseSerializedVehicleHotspotUpdates,
  parseVehicleHotspotUndoUpdates,
  type VehicleHotspotActionState,
  type VehicleHotspotUpdate,
} from "@/lib/admin/vehicle-hotspot-updates";
import {
  getProductHotspotAssignmentRpcErrorMessage,
  parseProductHotspotAssignmentUpdates,
  type ProductHotspotAssignmentActionState,
} from "@/lib/admin/product-hotspot-assignments";

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function productRpcError(error: ProductRpcErrorLike, context: string): Error {
  return toProductRpcError(error, (details) => console.error(context, details));
}

function productListFiltersFromConfig(config: AdminProductListConfig) {
  return {
    categorySlug: config.category || undefined,
    published: config.status === "published" ? true : config.status === "draft" ? false : undefined,
    availability: config.availability || undefined,
    sort: config.sort,
  };
}

async function getProductMutationRedirect(options: {
  slug: string;
  flashAction: "created" | "updated";
  product: { categorySlug: string; published: boolean; availability: ProductAvailability };
  photoErrorCount?: number;
}): Promise<string> {
  const cookieStore = await cookies();
  const savedConfig = parseAdminProductListConfigCookie(
    cookieStore.get(ADMIN_PRODUCT_LIST_CONFIG_COOKIE)?.value,
  );
  const baseConfig = savedConfig ?? DEFAULT_ADMIN_PRODUCT_LIST_CONFIG;
  const targetView = getRelaxedAdminProductListConfig(baseConfig, options.product);
  const result = await buildAdminProductMutationRedirectFailSoft({
    config: targetView.config,
    flashAction: options.flashAction,
    slug: options.slug,
    photoErrorCount: options.photoErrorCount,
    relaxed: savedConfig ? targetView.relaxed : [],
  }, () => getAdminProductTargetPage(options.slug, productListFiltersFromConfig(targetView.config)));

  if (result.lookupError) {
    Sentry.captureException(result.lookupError, {
      tags: { subsystem: "admin-product-target-page", action: options.flashAction },
      extra: { productSlug: options.slug, sort: targetView.config.sort },
    });
  }

  return result.href;
}

async function removeFilesAfterDatabaseDelete(
  supabase: ReturnType<typeof createAdminClient>,
  paths: string[],
  entityType: "category" | "subcategory",
): Promise<void> {
  if (paths.length === 0) return;

  const { error } = await supabase.storage.from("category-images").remove(paths);
  if (error) {
    // The database deletion is already committed. An orphaned file is safer
    // than deleting files first and then discovering that a foreign key kept
    // the category alive. Report cleanup for retry without turning a completed
    // deletion into a misleading UI failure.
    Sentry.captureException(error, {
      tags: { subsystem: "admin-storage-cleanup", entityType },
      extra: { bucket: "category-images", fileCount: paths.length },
    });
  }
}

export type FormActionState = { error: string } | null;

// redirect() reports success by throwing a special error tagged with this
// digest prefix — runFormAction must let it pass through instead of turning
// it into a displayed error. Not part of next/navigation's public API (only
// the internal build path exports isRedirectError), so this checks the
// documented digest shape directly instead of reaching into next/dist.
function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

// Every create/update Server Action bound directly to a <form action> (via
// useActionState) goes through this instead of letting validation/Supabase
// errors throw: an uncaught throw here bubbles to error.tsx, which unmounts
// the whole form and wipes every field the admin already filled in. Wrapping
// it turns that into a returned {error} the form can show inline while
// keeping its state intact.
async function runFormAction(fn: () => Promise<void>): Promise<FormActionState> {
  try {
    await fn();
    return null;
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: getErrorMessage(error, "Не удалось сохранить изменения.") };
  }
}

export async function login(formData: FormData): Promise<void> {
  const password = formData.get("password");
  const credentialState = await getAdminCredentialState();
  const passwordIsValid = typeof password === "string" && (await verifyAdminPassword(password, credentialState));
  let retryAfter: number;
  try {
    retryAfter = await registerLoginAttempt(passwordIsValid);
  } catch (error) {
    if (error instanceof AdminLoginProtectionUnavailableError) {
      redirect("/admin/login?error=security");
    }
    throw error;
  }

  if (retryAfter > 0) {
    redirect(`/admin/login?error=rate&retry=${retryAfter}`);
  }
  if (!passwordIsValid) {
    redirect("/admin/login?error=1");
  }

  const token = await createSessionToken({ credentialVersion: credentialState.sessionVersion });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });

  redirect("/admin/welcome");
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
  const payload = await getSessionPayload(token);
  if (!payload) {
    redirect("/admin/login");
  }
  const credentialVersion = await getAdminCredentialVersion();
  if (payload.credentialVersion !== credentialVersion) {
    cookieStore.delete(SESSION_COOKIE_NAME);
    redirect("/admin/login?session=expired");
  }
}

export type PasswordChangeState = { error: string } | null;

export async function changeAdminPassword(
  _previousState: PasswordChangeState,
  formData: FormData,
): Promise<PasswordChangeState> {
  try {
    await requireAdminSession();
    // Password verification needs the current hash, not just the briefly
    // cached session version used by ordinary admin actions.
    const credentialState = await getAdminCredentialState();
    const currentPassword = formData.get("currentPassword");
    const newPassword = formData.get("newPassword");
    const confirmation = formData.get("confirmPassword");

    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string" ||
      typeof confirmation !== "string"
    ) {
      return { error: "Заполните все поля формы." };
    }

    const validationError = validateNewAdminPassword(newPassword, confirmation);
    if (validationError) return { error: validationError };

    const currentPasswordIsValid = await verifyAdminPassword(currentPassword, credentialState);
    const retryAfter = await registerLoginAttempt(currentPasswordIsValid, "password-change");
    if (retryAfter > 0) {
      const retryMinutes = Math.max(1, Math.ceil(retryAfter / 60));
      return { error: `Слишком много попыток. Повторите примерно через ${retryMinutes} мин.` };
    }
    if (!currentPasswordIsValid) return { error: "Текущий пароль указан неверно." };
    if (await constantTimePasswordEqual(newPassword, currentPassword)) {
      return { error: "Новый пароль должен отличаться от текущего." };
    }

    const passwordHash = await hashAdminPassword(newPassword);
    await replaceAdminPasswordHash(passwordHash, credentialState.sessionVersion);

    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE_NAME);
    redirect("/admin/login?changed=1");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof AdminCredentialConflictError) {
      return { error: "Пароль уже изменён в другой сессии. Войдите снова." };
    }
    return { error: getErrorMessage(error, "Не удалось изменить пароль.") };
  }
}

interface ProductFormFields {
  name: string;
  slugSeed: string;
  categorySlug: string;
  subcategorySlug: string | null;
  compatibleBrands: string[];
  vehicleTypes: string[];
  shortDescription: string;
  description: string | null;
  article: string | null;
  published: boolean;
  availability: ProductAvailability;
  metaTitle: string | null;
  metaDescription: string | null;
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
  const vehicleTypes = formData.getAll("vehicleTypes").map(String);
  // Краткое описание необязательно (PROJECT_BRIEF) — карточка товара на
  // публичном сайте уже отображает пустую строку без ошибки, если поле не
  // заполнено.
  const shortDescription = String(formData.get("shortDescription") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const article = String(formData.get("article") ?? "").trim() || null;
  const published = formData.get("published") === "on";
  const availabilityRaw = formData.get("availability");
  const availability = isProductAvailability(String(availabilityRaw ?? ""))
    ? (availabilityRaw as ProductAvailability)
    : DEFAULT_PRODUCT_AVAILABILITY;
  const metaTitle = String(formData.get("metaTitle") ?? "").trim() || null;
  const metaDescription = String(formData.get("metaDescription") ?? "").trim() || null;
  const attributes = formData.getAll("characteristicAttribute").map(String);
  const values = formData.getAll("characteristicValue").map(String);
  const characteristics = attributes
    .map((attribute, i) => ({ attribute: attribute.trim(), value: (values[i] ?? "").trim() }))
    .filter((c) => c.attribute && c.value);

  if (!name || !categorySlug) {
    throw new Error("Заполните обязательные поля: название, категория.");
  }

  return {
    name,
    slugSeed,
    categorySlug,
    subcategorySlug,
    compatibleBrands,
    vehicleTypes,
    shortDescription,
    description,
    article,
    published,
    availability,
    metaTitle,
    metaDescription,
    characteristics,
  };
}

// Проверка ссылок товара и разрешение подкатегории живут в Postgres
// (resolve_product_references): они должны выполняться в той же транзакции, что
// и запись, иначе между проверкой и записью остаётся окно, в котором связь
// может исчезнуть. Прежние клиентские версии этих проверок удалены, чтобы не
// возникло двух расходящихся источников правды.

// Shared by every create action's "append at the end" ordering: the next
// row's order is one past the current max (or 0 for the first row).
// `filters` scopes the max lookup to tables where order is per-parent
// (subcategories, category_brands) rather than global.
async function getNextOrder(
  supabase: ReturnType<typeof createAdminClient>,
  table: "products" | "brands" | "categories" | "subcategories" | "category_brands" | "vehicle_types",
  filters?: Record<string, string>
): Promise<number> {
  let query = supabase.from(table).select("order").order("order", { ascending: false }).limit(1);
  for (const [column, value] of Object.entries(filters ?? {})) {
    query = query.eq(column, value);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data?.order ?? -1) + 1;
}

// Every admin mutation eventually surfaces somewhere on the public catalog
// (a product/category/brand page, or just the homepage nav) — those pages
// are now ISR-cached (see the `revalidate` exports under src/app/(site)),
// so an edit has to explicitly bust that cache too, not just the admin's
// own pages. "layout" + "/" covers every route under the public root
// layout without having to enumerate each affected URL.
function revalidatePublicSite(): void {
  revalidatePath("/", "layout");
}

async function generateUniqueSlug(
  supabase: ReturnType<typeof createAdminClient>,
  table: "products" | "brands" | "categories" | "vehicle_types",
  seed: string,
  fallback: string
): Promise<string> {
  const base = slugify(seed) || fallback;
  let candidate = base;
  let suffix = 2;
  for (;;) {
    const { data, error } = await supabase.from(table).select("slug").eq("slug", candidate).maybeSingle();
    if (error) throw error;
    if (!data) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

function parsePhotoMode(formData: FormData): ProductPhotoMode {
  const raw = formData.get("photoMode");
  return typeof raw === "string" && isProductPhotoMode(raw) ? raw : DEFAULT_PRODUCT_PHOTO_MODE;
}

// "normal"/"webp" arrive already finished — the client did the resizing and
// (for "webp") the re-encode before submitting (see compress-image.ts /
// ProductForm.tsx). Only the two script-processing modes have work left:
// the enhance-product-photo pipeline (crop to the alpha bounding box, tone
// correction, watermark), then an optional WebP re-encode of its output.
async function applyPhotoMode(file: File, photoMode: ProductPhotoMode): Promise<File> {
  if (!usesScriptProcessing(photoMode)) return file;

  const enhanced = await enhanceProductPhotoBuffer(Buffer.from(await file.arrayBuffer()));
  const toWebp = usesWebpOutput(photoMode);
  const finalBuffer = toWebp ? await convertBufferToWebp(enhanced) : enhanced;
  const extension = toWebp ? "webp" : "png";
  const newName = file.name.replace(/\.[^./]+$/, "") + "." + extension;
  // Buffer's ArrayBufferLike is wider than BlobPart's ArrayBuffer-only view —
  // wrapping in a plain Uint8Array satisfies the type without copying data.
  return new File([new Uint8Array(finalBuffer)], newName, { type: toWebp ? "image/webp" : "image/png" });
}

// Sequential on purpose: each script-processing photo runs several
// CPU-bound sharp passes (tone correction, two raw-pixel scans, resize,
// composite) — running up to MAX_PRODUCT_IMAGES of those concurrently would
// contend for the same CPU budget for no speed benefit in a serverless
// function, and makes the already-real execution-time risk worse.
async function applyPhotoModeToAll(photos: File[], photoMode: ProductPhotoMode): Promise<File[]> {
  const processed: File[] = [];
  for (const file of photos) {
    processed.push(await applyPhotoMode(file, photoMode));
  }
  return processed;
}

export async function createProduct(
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  return runFormAction(async () => {
  await requireAdminSession();
  const fields = parseProductFormData(formData);
  const supabase = createAdminClient();
  const photos = formData.getAll("photos").filter((file): file is File => file instanceof File && file.size > 0);
  const photoMode = parsePhotoMode(formData);

  if (photos.length > MAX_PRODUCT_IMAGES) {
    throw new Error(`Можно загрузить не более ${MAX_PRODUCT_IMAGES} фотографий товара.`);
  }
  await Promise.all(photos.map(validateProductImage));
  const processedPhotos = photos.length > 0 ? await applyPhotoModeToAll(photos, photoMode) : [];

  // Товар и все его связи пишутся одной транзакцией внутри Postgres. Прежде это
  // были отдельные запросы с компенсирующим DELETE, который сам мог не
  // сработать и оставить в базе частичный товар. Проверка ссылок, подбор
  // уникального slug и следующий порядок выполняются там же, поэтому два
  // одновременных создания больше не могут выбрать одно и то же значение.
  //
  // Фотографии сознательно остаются снаружи: Storage не участвует в транзакции
  // Postgres, а загрузка — медленный шаг, из-за которого одна неудачная
  // фотография не должна отменять уже корректный товар. Её жизненный цикл —
  // предмет фазы 3.
  const { data: created, error } = await supabase
    .rpc("create_product_with_relations", {
      p_slug_base: slugify(fields.slugSeed) || "product",
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
    })
    .single<{ out_id: string; out_slug: string }>();
  if (error) throw productRpcError(error, "Ошибка создания товара");

  const productId = created.out_id;
  const slug = created.out_slug;

  // Each photo uploads and inserts independently (allSettled, not all): a
  // failed photo is reported to the admin via the redirect's photoError
  // count, not treated as fatal — the product and every photo that did
  // succeed stay saved, and any missing photo can be added from the edit
  // page exactly like edit mode's own per-photo upload already works today.
  let photoErrorCount = 0;
  if (processedPhotos.length > 0) {
    const photoResults = await Promise.allSettled(
      processedPhotos.map((file, i) => insertProductImage(supabase, productId, slug, file, i))
    );
    photoErrorCount = photoResults.filter((result) => result.status === "rejected").length;
    if (photoErrorCount > 0) {
      console.error("Не удалось загрузить часть фотографий при создании товара", {
        productId,
        slug,
        failed: photoErrorCount,
        total: processedPhotos.length,
        reasons: photoResults
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => getErrorMessage(result.reason, "неизвестная ошибка")),
      });
    }
  }

  revalidatePath("/admin/products");
  revalidatePublicSite();
  const destination = await getProductMutationRedirect({
    slug,
    flashAction: "created",
    product: {
      categorySlug: fields.categorySlug,
      published: fields.published,
      availability: fields.availability,
    },
    photoErrorCount,
  });
  redirect(destination);
  });
}

export async function updateProduct(
  slug: string,
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  return runFormAction(async () => {
  await requireAdminSession();
  const fields = parseProductFormData(formData);
  const supabase = createAdminClient();

  // Версия, которую видел администратор при открытии формы. Передаётся строкой
  // ровно в том виде, в каком пришла из базы: разбор в Date обрезал бы
  // микросекунды до миллисекунд, и любое сохранение выглядело бы конфликтом.
  const expectedUpdatedAt = String(formData.get("expectedUpdatedAt") ?? "").trim() || null;

  // Строка товара, все три дочерние таблицы и публикация меняются одной
  // транзакцией. Прежде это были отдельные запросы без компенсации: сбой на
  // середине оставлял товар обновлённым, но, например, с полностью стёртыми
  // совместимыми брендами. Публикация писалась отдельным запросом после связей
  // именно из-за этого — внутри транзакции такая предосторожность не нужна.
  const { error: updateError } = await supabase
    .rpc("update_product_with_relations", {
      p_slug: slug,
      p_expected_updated_at: expectedUpdatedAt,
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
    })
    .single<{ out_id: string; out_updated_at: string }>();
  if (updateError) throw productRpcError(updateError, "Ошибка обновления товара");

  revalidatePath(`/admin/products/${slug}/edit`);
  revalidatePath("/admin/products");
  revalidatePublicSite();
  const destination = await getProductMutationRedirect({
    slug,
    flashAction: "updated",
    product: {
      categorySlug: fields.categorySlug,
      published: fields.published,
      availability: fields.availability,
    },
  });
  redirect(destination);
  });
}

export async function deleteProduct(slug: string, redirectAfterDelete = true): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();

  const { data: product, error: findError } = await supabase
    .from("products")
    .select("id, product_images(url)")
    .eq("slug", slug)
    .maybeSingle<{ id: string; product_images: { url: string }[] }>();
  if (findError) throw findError;
  if (!product) {
    // Deletion is idempotent: a stale tab or a repeated confirmation already
    // has the desired database state and must not resurrect the old row.
    revalidatePath("/admin/products");
    revalidatePublicSite();
    if (redirectAfterDelete) redirect("/admin/products?notice=product-deleted");
    refresh();
    return;
  }

  // Сначала подтверждаем удаление в БД. Storage не участвует в транзакции:
  // если очистка файлов недоступна, товар всё равно не остаётся с битым фото.
  const { error: deleteError } = await supabase.from("products").delete().eq("id", product.id);
  if (deleteError) throw deleteError;

  const storagePaths = product.product_images
    .map((image) => extractStoragePath(image.url, "product-images"))
    .filter((path): path is string => Boolean(path));
  if (storagePaths.length > 0) {
    const { error: removeError } = await supabase.storage.from("product-images").remove(storagePaths);
    if (removeError) {
      console.error("Не удалось очистить файлы удалённого товара", {
        productSlug: slug,
        message: removeError.message,
      });
    }
  }
  revalidatePath("/admin/products");
  revalidatePublicSite();
  if (redirectAfterDelete) redirect("/admin/products?notice=product-deleted");
  refresh();
}

// A quick from-the-list toggle for the products list's status pill — a
// separate immediate action rather than routing through the full edit form,
// same reasoning as reorderProducts/deleteProduct being their own actions.
export async function toggleProductPublished(
  slug: string,
  published: boolean,
  confirmedUnpublish = false,
): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();
  const { data: product, error: findError } = await supabase
    .from("products")
    .select("id, published")
    .eq("slug", slug)
    .maybeSingle();
  if (findError) throw findError;
  if (!product) throw new Error("Товар не найден или уже удалён.");

  if (product.published && !published) {
    const { count: hotspotCount, error: hotspotCountError } = await supabase
      .from("vehicle_hotspots")
      .select("id", { count: "exact", head: true })
      .eq("product_id", product.id);
    if (hotspotCountError) throw hotspotCountError;
    if ((hotspotCount ?? 0) > 0 && !confirmedUnpublish) {
      throw new Error(
        `Подтвердите снятие с публикации: товар будет отвязан от ${hotspotCount} ${hotspotCount === 1 ? "хотспота" : "хотспотов"}.`,
      );
    }
  }

  const { error } = await supabase
    .from("products")
    .update({ published, updated_at: new Date().toISOString() })
    .eq("id", product.id);
  if (error) throw error;
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${slug}/edit`);
  revalidatePublicSite();
}

// A quick from-the-list toggle for the products list's availability
// control — separate from toggleProductPublished on purpose: availability is
// a purely informational badge (PROJECT_BRIEF), it never touches vehicle
// hotspot assignments, so it carries none of that action's confirmation
// logic.
export async function toggleProductAvailability(slug: string, availability: ProductAvailability): Promise<void> {
  await requireAdminSession();
  if (!isProductAvailability(availability)) {
    throw new Error("Недопустимый статус наличия.");
  }
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("products")
    .update({ availability, updated_at: new Date().toISOString() })
    .eq("slug", slug);
  if (error) throw error;
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${slug}/edit`);
  revalidatePublicSite();
}

// v1 bulk scope is deliberately narrow (PROJECT_BRIEF): only published and
// availability. One update(...).in(...) instead of N per-row calls — same
// reasoning as reorderProducts moving off N parallel requests.
export async function bulkUpdateProducts(slugs: string[], patch: BulkProductPatch): Promise<void> {
  await requireAdminSession();
  const uniqueSlugs = normalizeBulkProductSlugs(slugs);
  if (uniqueSlugs.length === 0) return;

  const fields = buildBulkProductUpdateFields(patch);
  if (!fields) return;
  const update = { ...fields, updated_at: new Date().toISOString() };

  const supabase = createAdminClient();
  // Unpublishing detaches vehicle hotspots via a DB trigger regardless of how
  // many rows a single UPDATE touches — bulk unpublish here intentionally
  // skips the per-product hotspot confirmation the single-item toggle
  // requires, since the admin already confirmed the bulk action itself in
  // the UI before this action ran.
  const { error } = await supabase.from("products").update(update).in("slug", uniqueSlugs);
  if (error) throw error;
  revalidatePath("/admin/products");
  revalidatePublicSite();
}

// Один запрос в транзакции вместо UPDATE на каждую позицию: при каталоге в
// 2000 товаров прежний вариант слал 2000 параллельных запросов к PostgREST и
// при частичном сбое оставлял порядок в противоречивом состоянии.
//
// reorder_products переставляет товары внутри уже занятых ими значений order,
// а не нумерует их подряд от нуля. Поэтому перетаскивание корректно работает
// и в отфильтрованном или постраничном срезе: товары вне выборки сохраняют
// свои позиции, а сквозной порядок каталога не ломается.
export async function reorderProducts(orderedSlugs: string[]): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("reorder_products", { ordered_slugs: orderedSlugs });
  if (error) throw error;
  revalidatePath("/admin/products");
  revalidatePublicSite();
}

interface UploadedImage {
  id: string;
  url: string;
  order: number;
  scale: number | null;
}

// Shared by uploadProductImage (edit mode's immediate per-photo upload) and
// createProduct (photos attached in the same submission as the rest of the
// row) — both need "store the file under this product's slug, then record
// the row," just triggered from different places.
async function insertProductImage(
  supabase: ReturnType<typeof createAdminClient>,
  productId: string,
  productSlug: string,
  file: File,
  order: number
): Promise<UploadedImage> {
  await validateProductImage(file);
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${productSlug}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(path, file, { contentType: file.type });
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from("product-images").getPublicUrl(path);

  const { data: inserted, error: insertError } = await supabase
    .from("product_images")
    .insert({ product_id: productId, url: publicUrlData.publicUrl, order })
    .select("id, url, order, scale")
    .single();
  if (insertError) {
    const { error: cleanupError } = await supabase.storage.from("product-images").remove([path]);
    if (cleanupError) {
      console.error("Не удалось удалить orphan-файл фотографии", {
        productSlug,
        path,
        message: cleanupError.message,
      });
    }
    throw insertError;
  }
  return inserted;
}

// Returns the inserted row directly rather than relying on revalidatePath +
// router.refresh() — ProductForm's local `images` state is seeded from
// `product.images` only once, on mount (so an in-progress edit to other
// fields isn't wiped out by a refetch); a refresh-driven prop update would
// never reach it. The caller appends this return value to state itself.
//
// `order` is passed in by the caller (instead of this action computing it
// via getNextOrder) so that uploading several photos at once can run all of
// them concurrently: if each call independently looked up "the current max
// order," two uploads racing in parallel could both read the same max and
// collide on the same order value. The caller already knows how many images
// exist locally, so it can hand out distinct order values up front.
export async function uploadProductImage(
  productId: string,
  formData: FormData,
  order: number
): Promise<UploadedImage | null> {
  await requireAdminSession();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  await validateProductImage(file);

  const supabase = createAdminClient();
  const [{ data: product, error: productError }, { count, error: countError }] = await Promise.all([
    supabase
    .from("products")
    .select("slug")
    .eq("id", productId)
    .maybeSingle(),
    supabase.from("product_images").select("id", { count: "exact", head: true }).eq("product_id", productId),
  ]);
  if (productError) throw productError;
  if (countError) throw countError;
  if (!product) return null;
  if ((count ?? 0) >= MAX_PRODUCT_IMAGES) {
    throw new Error(`У товара уже максимальное количество фотографий: ${MAX_PRODUCT_IMAGES}.`);
  }

  const inserted = await insertProductImage(supabase, productId, product.slug, file, order);

  revalidatePath("/admin/products");
  revalidatePublicSite();
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

  const { error: deleteError } = await supabase.from("product_images").delete().eq("id", imageId);
  if (deleteError) throw deleteError;

  const storagePath = extractStoragePath(image.url, "product-images");
  if (storagePath) {
    const { error: removeError } = await supabase.storage.from("product-images").remove([storagePath]);
    if (removeError) {
      console.error("Не удалось очистить файл удалённой фотографии", {
        imageId,
        message: removeError.message,
      });
    }
  }

  revalidatePath(`/admin/products/${image.products.slug}/edit`);
  revalidatePublicSite();
}

export async function reorderProductImages(productSlug: string, orderedImageIds: string[]): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();
  // Товар передаётся в RPC, а не только в revalidatePath: без него порядок
  // фотографий не был ограничен родителем и принимал чужие идентификаторы.
  const { error } = await supabase.rpc("reorder_product_images", {
    target_product_slug: productSlug,
    ordered_ids: orderedImageIds,
  });
  if (error) throw error;
  revalidatePath(`/admin/products/${productSlug}/edit`);
  revalidatePublicSite();
}

// Mirrors updateCategoryBrandOverride — same "per-row visual scale
// correction, saved immediately on blur" pattern, just for a product's
// photos instead of a category's attached brands.
export async function updateProductImageScale(
  productSlug: string,
  imageId: string,
  scale: number | null
): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("product_images")
    .update({ scale: normalizeVisualScale(scale) })
    .eq("id", imageId);
  if (error) throw error;
  revalidatePath(`/admin/products/${productSlug}/edit`);
  revalidatePublicSite();
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

  if (!name || !country) {
    throw new Error("Заполните обязательные поля: название, страна.");
  }

  // Прежде нечисловой ввод молча превращался в null: админ видел «сохранено», а
  // масштаб терялся. Теперь недопустимое значение отвергается с сообщением.
  return { name, slugSeed, country, logoScale: normalizeVisualScale(logoScaleRaw) };
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
export async function createBrand(
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  return runFormAction(async () => {
  await requireAdminSession();
  const fields = parseBrandFormData(formData);
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Логотип обязателен.");
  }

  const supabase = createAdminClient();
  const slug = await generateUniqueSlug(supabase, "brands", fields.slugSeed, "brand");
  const [logoUrl, nextOrder] = await Promise.all([
    uploadBrandLogo(supabase, slug, file),
    getNextOrder(supabase, "brands"),
  ]);

  const { error } = await supabase.from("brands").insert({
    slug,
    name: fields.name,
    country: fields.country,
    logo: logoUrl,
    logo_scale: fields.logoScale,
    order: nextOrder,
  });
  if (error) {
    const path = extractStoragePath(logoUrl, "brand-logos");
    if (path) await supabase.storage.from("brand-logos").remove([path]);
    throw error;
  }

  revalidatePath("/admin/brands");
  revalidatePublicSite();
  redirect(`/admin/brands?created=${encodeURIComponent(slug)}`);
  });
}

// Text fields only — logo replacement is a separate immediate action
// (replaceBrandLogo) so its result can be pushed straight into BrandForm's
// local state, the same fix applied to product photo uploads (see
// uploadProductImage's comment): a `<form action>` Server Action's return
// value isn't visible to the component without useActionState, and this
// form doesn't need that complexity for its own text fields.
export async function updateBrand(
  slug: string,
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  return runFormAction(async () => {
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
  revalidatePublicSite();
  redirect(`/admin/brands?updated=${encodeURIComponent(slug)}`);
  });
}

export async function replaceBrandLogo(slug: string, formData: FormData): Promise<string | null> {
  await requireAdminSession();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return null;

  const supabase = createAdminClient();
  const [{ data: existing }, newLogoUrl] = await Promise.all([
    supabase.from("brands").select("logo").eq("slug", slug).maybeSingle(),
    uploadBrandLogo(supabase, slug, file),
  ]);

  const { error } = await supabase.from("brands").update({ logo: newLogoUrl }).eq("slug", slug);
  if (error) throw error;

  if (existing?.logo) {
    const oldPath = extractStoragePath(existing.logo, "brand-logos");
    if (oldPath) await supabase.storage.from("brand-logos").remove([oldPath]);
  }

  revalidatePath("/admin/brands");
  revalidatePublicSite();
  return newLogoUrl;
}

export async function deleteBrand(slug: string, redirectAfterDelete = true): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();

  const { data: brand, error: brandLookupError } = await supabase.from("brands").select("logo").eq("slug", slug).maybeSingle();
  if (brandLookupError) throw brandLookupError;
  if (brand?.logo) {
    const path = extractStoragePath(brand.logo, "brand-logos");
    if (path) {
      const { error: removeError } = await supabase.storage.from("brand-logos").remove([path]);
      if (removeError) throw removeError;
    }
  }

  // Cascades clean up product_brands/category_brands associations — the
  // BrandsList UI warns with usage counts before calling this.
  const { error } = await supabase.from("brands").delete().eq("slug", slug);
  if (error) throw error;

  revalidatePath("/admin/brands");
  revalidatePublicSite();
  if (redirectAfterDelete) redirect("/admin/brands?notice=brand-deleted");
  refresh();
}

export async function reorderBrands(orderedSlugs: string[]): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("reorder_brands", { ordered_slugs: orderedSlugs });
  if (error) throw error;
  revalidatePath("/admin/brands");
  revalidatePublicSite();
}

const CATEGORY_ICONS: CategoryIcon[] = ["hydraulic-pump", "pto", "pto-shaft", "tank"];

interface CategoryFormFields {
  name: string;
  slugSeed: string;
  description: string;
  icon: CategoryIcon;
  // undefined = the "type" field wasn't submitted at all (the edit form
  // never includes it — type is immutable after create, see updateCategory's
  // comment below) or held an unrecognized value. null = explicitly chosen
  // "Напрямую" (direct/flat category, no subcategory or brand grouping).
  // createCategory below is the only caller that must reject `undefined`.
  type: "subcategory" | "brand" | null | undefined;
  intro: string | null;
}

function parseCategoryType(formData: FormData): "subcategory" | "brand" | null | undefined {
  const raw = formData.get("type");
  if (raw === "subcategory" || raw === "brand") return raw;
  if (raw === "direct") return null;
  return undefined;
}

function parseCategoryFormData(formData: FormData): CategoryFormFields {
  const name = String(formData.get("name") ?? "").trim();
  const slugSeed = String(formData.get("slug") ?? "").trim() || name;
  const description = String(formData.get("description") ?? "").trim();
  const iconRaw = String(formData.get("icon") ?? "");
  const icon = CATEGORY_ICONS.includes(iconRaw as CategoryIcon) ? (iconRaw as CategoryIcon) : CATEGORY_ICONS[0];
  const type = parseCategoryType(formData);
  const intro = String(formData.get("intro") ?? "").trim() || null;

  if (!name) {
    throw new Error("Заполните обязательное поле: название.");
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
export async function createCategory(
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  return runFormAction(async () => {
  await requireAdminSession();
  const fields = parseCategoryFormData(formData);
  if (fields.type === undefined) {
    throw new Error("Выберите тип категории.");
  }
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Изображение обязательно.");
  }

  const supabase = createAdminClient();
  const slug = await generateUniqueSlug(supabase, "categories", fields.slugSeed, "category");
  const [imageUrl, nextOrder] = await Promise.all([
    uploadCategoryImage(supabase, slug, file),
    getNextOrder(supabase, "categories"),
  ]);

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
  if (error) {
    const path = extractStoragePath(imageUrl, "category-images");
    if (path) await supabase.storage.from("category-images").remove([path]);
    throw error;
  }

  revalidatePath("/admin/categories");
  revalidatePublicSite();
  redirect(`/admin/categories?created=${encodeURIComponent(slug)}`);
  });
}

// Text fields only, same reasoning as updateBrand — image replacement is
// its own immediate action (replaceCategoryImage) so the result can be
// pushed straight into CategoryForm's local state. `type` is never updated
// here (see createCategory's comment) and neither is `slug` (locked after
// create, same as products/brands, to avoid breaking existing links).
export async function updateCategory(
  slug: string,
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  return runFormAction(async () => {
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
  revalidatePublicSite();
  redirect(`/admin/categories?updated=${encodeURIComponent(slug)}`);
  });
}

export async function replaceCategoryImage(slug: string, formData: FormData): Promise<string | null> {
  await requireAdminSession();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return null;

  const supabase = createAdminClient();
  const [{ data: existing }, newImageUrl] = await Promise.all([
    supabase.from("categories").select("image").eq("slug", slug).maybeSingle(),
    uploadCategoryImage(supabase, slug, file),
  ]);

  const { error } = await supabase.from("categories").update({ image: newImageUrl }).eq("slug", slug);
  if (error) throw error;

  if (existing?.image) {
    const oldPath = extractStoragePath(existing.image, "category-images");
    if (oldPath) await supabase.storage.from("category-images").remove([oldPath]);
  }

  revalidatePath("/admin/categories");
  revalidatePublicSite();
  return newImageUrl;
}

export async function deleteCategory(slug: string, redirectAfterDelete = true): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();

  const { data: files, error: listError } = await supabase.storage.from("category-images").list(slug);
  if (listError) throw listError;
  const storagePaths = (files ?? []).map((file) => `${slug}/${file.name}`);

  // Subcategory images live in their own sub-{id} folders, not nested under
  // this category's — the DB cascade below clears subcategory rows but
  // wouldn't reach their Storage files, so collect those paths before the
  // rows disappear and clean them only after the database delete succeeds.
  // Parallel, not sequential: a category can have many subcategories, and
  // each folder listing is independent with nothing to serialize.
  const { data: subcategories, error: subcategoriesError } = await supabase
    .from("subcategories")
    .select("id")
    .eq("category_slug", slug);
  if (subcategoriesError) throw subcategoriesError;
  const subcategoryStoragePaths = await Promise.all(
    (subcategories ?? []).map(async (sub) => {
      const { data: subFiles, error: subListError } = await supabase.storage
        .from("category-images")
        .list(`sub-${sub.id}`);
      if (subListError) throw subListError;
      return (subFiles ?? []).map((file) => `sub-${sub.id}/${file.name}`);
    }),
  );
  storagePaths.push(...subcategoryStoragePaths.flat());

  // Cascades clean up subcategories/category_brands; products.category_slug
  // has no cascade, so this throws (FK violation) if any product still
  // references this category — CategoriesList checks productCount before
  // calling this to avoid surfacing that raw error.
  const { error } = await supabase.from("categories").delete().eq("slug", slug);
  if (error) throw error;
  await removeFilesAfterDatabaseDelete(supabase, storagePaths, "category");

  revalidatePath("/admin/categories");
  revalidatePublicSite();
  if (redirectAfterDelete) redirect("/admin/categories?notice=category-deleted");
  refresh();
}

export async function reorderCategories(orderedSlugs: string[]): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("reorder_categories", { ordered_slugs: orderedSlugs });
  if (error) throw error;
  revalidatePath("/admin/categories");
  revalidatePublicSite();
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
export async function createSubcategory(
  categorySlug: string,
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  return runFormAction(async () => {
  await requireAdminSession();
  const fields = parseSubcategoryFormData(formData);
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Изображение обязательно.");
  }

  const supabase = createAdminClient();
  const id = crypto.randomUUID();
  const [slug, imageUrl, nextOrder] = await Promise.all([
    generateUniqueSubcategorySlug(supabase, categorySlug, fields.slugSeed),
    uploadCategoryImage(supabase, `sub-${id}`, file),
    getNextOrder(supabase, "subcategories", { category_slug: categorySlug }),
  ]);

  const { error } = await supabase.from("subcategories").insert({
    id,
    category_slug: categorySlug,
    slug,
    name: fields.name,
    image: imageUrl,
    intro: fields.intro,
    order: nextOrder,
  });
  if (error) {
    const path = extractStoragePath(imageUrl, "category-images");
    if (path) await supabase.storage.from("category-images").remove([path]);
    throw error;
  }

  revalidatePath(`/admin/categories/${categorySlug}/subcategories`);
  revalidatePublicSite();
  redirect(`/admin/categories/${categorySlug}/subcategories?created=${encodeURIComponent(slug)}`);
  });
}

export async function updateSubcategory(
  categorySlug: string,
  subSlug: string,
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  return runFormAction(async () => {
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
  revalidatePublicSite();
  redirect(`/admin/categories/${categorySlug}/subcategories?updated=${encodeURIComponent(subSlug)}`);
  });
}

export async function replaceSubcategoryImage(subcategoryId: string, formData: FormData): Promise<string | null> {
  await requireAdminSession();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return null;

  const supabase = createAdminClient();
  const { data: existing, error: lookupError } = await supabase
    .from("subcategories")
    .select("image, category_slug")
    .eq("id", subcategoryId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!existing) return null;

  const newImageUrl = await uploadCategoryImage(supabase, `sub-${subcategoryId}`, file);

  const { error } = await supabase.from("subcategories").update({ image: newImageUrl }).eq("id", subcategoryId);
  if (error) throw error;

  if (existing.image) {
    const oldPath = extractStoragePath(existing.image, "category-images");
    if (oldPath) await supabase.storage.from("category-images").remove([oldPath]);
  }

  revalidatePath(`/admin/categories/${existing.category_slug}/subcategories`);
  revalidatePublicSite();
  return newImageUrl;
}

export async function deleteSubcategory(subcategoryId: string, redirectAfterDelete = true): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();

  const { data: existing, error: lookupError } = await supabase
    .from("subcategories")
    .select("category_slug")
    .eq("id", subcategoryId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!existing) return;

  const { data: files, error: listError } = await supabase.storage
    .from("category-images")
    .list(`sub-${subcategoryId}`);
  if (listError) throw listError;
  const storagePaths = (files ?? []).map((file) => `sub-${subcategoryId}/${file.name}`);

  // products.subcategory_id has no cascade, so this throws (FK violation) if
  // any product still references it — SubcategoriesList checks productCount
  // before calling this to avoid surfacing that raw error.
  const { error } = await supabase.from("subcategories").delete().eq("id", subcategoryId);
  if (error) throw error;
  await removeFilesAfterDatabaseDelete(supabase, storagePaths, "subcategory");

  revalidatePath(`/admin/categories/${existing.category_slug}/subcategories`);
  revalidatePublicSite();
  if (redirectAfterDelete) {
    redirect(`/admin/categories/${existing.category_slug}/subcategories?notice=subcategory-deleted`);
  }
  refresh();
}

export async function reorderSubcategories(categorySlug: string, orderedIds: string[]): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();
  // Категория передаётся в RPC по той же причине, что и товар для фотографий:
  // иначе порядок принимал подкатегории чужой категории.
  const { error } = await supabase.rpc("reorder_subcategories", {
    target_category_slug: categorySlug,
    ordered_ids: orderedIds,
  });
  if (error) throw error;
  revalidatePath(`/admin/categories/${categorySlug}/subcategories`);
  revalidatePublicSite();
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
  revalidatePublicSite();
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
  revalidatePublicSite();
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
    .update({ logo_scale_override: normalizeVisualScale(logoScaleOverride) })
    .eq("category_slug", categorySlug)
    .eq("brand_slug", brandSlug);
  if (error) throw error;
  revalidatePath(`/admin/categories/${categorySlug}/category-brands`);
  revalidatePublicSite();
}

export async function reorderCategoryBrands(categorySlug: string, orderedBrandSlugs: string[]): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("reorder_category_brands", {
    target_category_slug: categorySlug,
    ordered_brand_slugs: orderedBrandSlugs,
  });
  if (error) throw error;
  revalidatePath(`/admin/categories/${categorySlug}/category-brands`);
  revalidatePublicSite();
}

interface VehicleTypeFormFields {
  name: string;
  slugSeed: string;
}

function parseVehicleTypeFormData(formData: FormData): VehicleTypeFormFields {
  const name = String(formData.get("name") ?? "").trim();
  const slugSeed = String(formData.get("slug") ?? "").trim() || name;

  if (!name) {
    throw new Error("Заполните обязательное поле: название.");
  }

  return { name, slugSeed };
}

// No logo/country, unlike brands — vehicle type is just a name/slug tag, so
// create/update are plain-field actions with no Storage involved at all.
export async function createVehicleType(
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  return runFormAction(async () => {
  await requireAdminSession();
  const fields = parseVehicleTypeFormData(formData);
  const supabase = createAdminClient();

  const [slug, nextOrder] = await Promise.all([
    generateUniqueSlug(supabase, "vehicle_types", fields.slugSeed, "vehicle-type"),
    getNextOrder(supabase, "vehicle_types"),
  ]);

  const { error } = await supabase.from("vehicle_types").insert({
    slug,
    name: fields.name,
    order: nextOrder,
  });
  if (error) throw error;

  revalidatePath("/admin/vehicle-types");
  revalidatePublicSite();
  redirect(`/admin/vehicle-types?created=${encodeURIComponent(slug)}`);
  });
}

export async function updateVehicleType(
  slug: string,
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  return runFormAction(async () => {
  await requireAdminSession();
  const fields = parseVehicleTypeFormData(formData);
  const supabase = createAdminClient();

  const { error } = await supabase.from("vehicle_types").update({ name: fields.name }).eq("slug", slug);
  if (error) throw error;

  revalidatePath("/admin/vehicle-types");
  revalidatePath(`/admin/vehicle-types/${slug}/edit`);
  revalidatePublicSite();
  redirect(`/admin/vehicle-types?updated=${encodeURIComponent(slug)}`);
  });
}

export async function deleteVehicleType(slug: string, redirectAfterDelete = true): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();

  // Cascades clean up product_vehicle_types associations — the
  // VehicleTypesList UI warns with a usage count before calling this.
  const { error } = await supabase.from("vehicle_types").delete().eq("slug", slug);
  if (error) throw error;

  revalidatePath("/admin/vehicle-types");
  revalidatePublicSite();
  if (redirectAfterDelete) redirect("/admin/vehicle-types?notice=vehicle-type-deleted");
  refresh();
}

export async function reorderVehicleTypes(orderedSlugs: string[]): Promise<void> {
  await requireAdminSession();
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("reorder_vehicle_types", { ordered_slugs: orderedSlugs });
  if (error) throw error;
  revalidatePath("/admin/vehicle-types");
  revalidatePublicSite();
}

const HOTSPOT_PRODUCT_SEARCH_LIMIT = 8;

interface VehicleHotspotRow {
  id: string;
}

interface HotspotProductRow {
  id: string;
  published: boolean;
}

function parseVehicleHotspotUpdates(formData: FormData): VehicleHotspotUpdate[] {
  const rawUpdates = formData.get("hotspots");
  return parseSerializedVehicleHotspotUpdates(rawUpdates);
}

async function runVehicleHotspotAction(
  fn: () => Promise<VehicleHotspotUpdate[]>,
): Promise<VehicleHotspotActionState> {
  try {
    const savedUpdates = await fn();
    return { success: true, savedUpdates };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: getErrorMessage(error, "Не удалось сохранить изменения хотспотов.") };
  }
}

async function persistVehicleHotspotUpdates(
  vehicleTypeSlug: string,
  updates: VehicleHotspotUpdate[],
  expectedUpdates?: VehicleHotspotUpdate[],
): Promise<VehicleHotspotUpdate[]> {
  const normalizedVehicleTypeSlug = vehicleTypeSlug.trim();
  if (!normalizedVehicleTypeSlug) throw new Error("Не выбран тип спецтехники.");

  const supabase = createAdminClient();
  const [{ data: hotspots, error: hotspotsError }, { data: vehicleType, error: vehicleTypeError }] = await Promise.all([
    supabase.from("vehicle_hotspots").select("id").eq("vehicle_type_slug", normalizedVehicleTypeSlug),
    supabase.from("vehicle_types").select("slug").eq("slug", normalizedVehicleTypeSlug).maybeSingle(),
  ]);
  if (hotspotsError) throw hotspotsError;
  if (vehicleTypeError) throw vehicleTypeError;
  if (!vehicleType) throw new Error("Тип спецтехники не найден.");

  const hotspotIds = new Set((hotspots as VehicleHotspotRow[]).map((hotspot) => hotspot.id));
  if (hotspotIds.size !== HOTSPOTS_PER_VEHICLE || updates.some((update) => !hotspotIds.has(update.id))) {
    throw new Error("Можно изменять только пять хотспотов выбранной техники.");
  }

  const productIds = updates.flatMap((update) => (update.productId ? [update.productId] : []));
  if (productIds.length > 0) {
    const uniqueProductIds = [...new Set(productIds)];
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, published")
      .in("id", uniqueProductIds);
    if (productsError) throw productsError;
    const productsById = new Map((products as HotspotProductRow[]).map((product) => [product.id, product]));
    if (
      productsById.size !== uniqueProductIds.length ||
      uniqueProductIds.some((productId) => productsById.get(productId)?.published !== true)
    ) {
      throw new Error("Закрепить можно только существующий опубликованный товар.");
    }
  }

  const { error: saveError } = expectedUpdates
    ? await supabase.rpc("restore_vehicle_hotspots", {
        target_vehicle_type_slug: normalizedVehicleTypeSlug,
        expected_hotspot_updates: expectedUpdates,
        prior_hotspot_updates: updates,
      })
    : await supabase.rpc("update_vehicle_hotspots", {
        target_vehicle_type_slug: normalizedVehicleTypeSlug,
        hotspot_updates: updates,
      });
  if (saveError) {
    if (expectedUpdates && saveError.message === "Hotspot state has changed since this batch was saved") {
      throw new Error("Данные хотспотов изменены другим администратором. Обновите страницу и повторите действие.");
    }
    throw saveError;
  }

  revalidatePath("/admin/vehicle-showcase");
  revalidatePublicSite();
  return updates;
}

// Server Actions are callable outside the rendered admin page, so the same
// validation that helps the form must happen here as well. The final write is
// delegated to a database RPC, which performs this transition in one
// transaction and closes the gap between validation and assignment.
export async function saveVehicleHotspots(
  vehicleTypeSlug: string,
  _prevState: VehicleHotspotActionState,
  formData: FormData
): Promise<VehicleHotspotActionState> {
  return runVehicleHotspotAction(async () => {
    await requireAdminSession();
    const updates = parseVehicleHotspotUpdates(formData);
    return persistVehicleHotspotUpdates(vehicleTypeSlug, updates);
  });
}

// Undo is a direct Client Component invocation, not a form post. The snapshot
// is therefore untrusted serialized input and goes through the exact same
// parser, product validation, transactional RPC, and cache invalidation as a
// normal save. If another admin claimed a product or it was unpublished in the
// meantime, the final RPC rejects the restore without partially changing rows.
export async function restoreVehicleHotspots(
  vehicleTypeSlug: string,
  priorUpdates: unknown,
  expectedSavedUpdates?: unknown,
): Promise<VehicleHotspotActionState> {
  return runVehicleHotspotAction(async () => {
    await requireAdminSession();
    const updates = parseVehicleHotspotUndoUpdates(priorUpdates);
    if (expectedSavedUpdates === undefined) {
      throw new Error("Не удалось подтвердить актуальность сохранённых данных. Обновите страницу и повторите действие.");
    }
    const expectedUpdates = parseVehicleHotspotUndoUpdates(expectedSavedUpdates);
    return persistVehicleHotspotUpdates(vehicleTypeSlug, updates, expectedUpdates);
  });
}

// Quick product actions use a small CAS batch rather than rewriting all five
// hotspots. The database locks and validates the whole transition atomically;
// the expected product ids make ordinary saves and Undo equally conflict-safe.
export async function updateProductHotspotAssignments(
  updates: unknown,
): Promise<ProductHotspotAssignmentActionState> {
  try {
    await requireAdminSession();
    const parsedUpdates = parseProductHotspotAssignmentUpdates(updates);
    const supabase = createAdminClient();
    const { error } = await supabase.rpc("update_vehicle_hotspot_assignments", {
      assignment_updates: parsedUpdates,
    });
    if (error) {
      const translatedMessage = getProductHotspotAssignmentRpcErrorMessage(error.message);
      if (translatedMessage) throw new Error(translatedMessage);
      throw error;
    }

    revalidatePath("/admin/products");
    revalidatePath("/admin/vehicle-showcase");
    revalidatePublicSite();
    return { success: true, savedUpdates: parsedUpdates };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: getErrorMessage(error, "Не удалось изменить закрепление товара.") };
  }
}

function escapeILikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}

// Kept as a Server Action (rather than importing a service-role query into a
// Client Component) because product names/articles and assignment state are
// admin-only lookup data. The final save validates again in case a result is
// claimed by another admin between this search and submission.
export async function searchAvailableHotspotProducts(
  query: string
): Promise<AdminAvailableProduct[]> {
  await requireAdminSession();
  const term = normalizeHotspotProductSearchQuery(query);
  if (!term) return [];

  const supabase = createAdminClient();
  const pattern = `%${escapeILikeTerm(term)}%`;
  const [{ data: nameMatches, error: nameError }, { data: articleMatches, error: articleError }] = await Promise.all([
    supabase
      .from("products")
      .select("id, slug, name, article, published")
      .eq("published", true)
      .ilike("name", pattern)
      .order("name")
      .limit(HOTSPOT_PRODUCT_SEARCH_LIMIT),
    supabase
      .from("products")
      .select("id, slug, name, article, published")
      .eq("published", true)
      .ilike("article", pattern)
      .order("name")
      .limit(HOTSPOT_PRODUCT_SEARCH_LIMIT),
  ]);
  if (nameError) throw nameError;
  if (articleError) throw articleError;

  const candidateIds = [...new Set([...(nameMatches ?? []), ...(articleMatches ?? [])].map((product) => product.id))];
  const { data: assignments, error: assignmentsError } =
    candidateIds.length > 0
      ? await supabase
          .from("vehicle_hotspots")
          .select("id, product_id, vehicle_type_slug, hotspot_number, label, vehicle_types(name, order)")
          .in("product_id", candidateIds)
      : { data: [], error: null };
  if (assignmentsError) throw assignmentsError;

  return selectAvailableHotspotProducts({
    nameMatches: (nameMatches ?? []) as Parameters<typeof selectAvailableHotspotProducts>[0]["nameMatches"],
    articleMatches: (articleMatches ?? []) as Parameters<typeof selectAvailableHotspotProducts>[0]["articleMatches"],
    assignments: (assignments ?? []) as Parameters<typeof selectAvailableHotspotProducts>[0]["assignments"],
    limit: HOTSPOT_PRODUCT_SEARCH_LIMIT,
  });
}
