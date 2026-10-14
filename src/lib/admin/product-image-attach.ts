import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { uploadPublicMediaObject } from "@/lib/media-storage";
import { buildR2PublicUrl } from "@/lib/media-storage-core";
import { generateProductImageVariants, VARIANT_UPLOAD_OPTIONS } from "@/lib/admin/product-image-variants.core.mjs";
import { convertBufferToWebp, enhanceProductPhotoBuffer } from "@/lib/admin/enhance-product-photo";
import { validateRasterImage } from "@/lib/admin/image-validation";
import { PRODUCT_IMAGE_STAGING_BUCKET, CANONICAL_UPLOAD_EXTENSION } from "@/lib/admin/product-image-staging";
import { usesScriptProcessing, usesWebpOutput, type ProductPhotoMode } from "@/lib/admin/product-photo-mode";

// The work that turns a photo waiting in private staging into a product photo: re-check the file, apply
// the chosen photo mode, store the master and the two WebP variants, record the row. It is shared by two
// callers: the admin action (immediately, on the Vercel build) and the photo queue runner (in the
// background, for the Cloudflare admin). It needs Sharp, so it never runs inside a Worker.
type AdminClient = ReturnType<typeof createAdminClient>;

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function mediaUrlForCurrentWriteTarget(
  supabase: AdminClient,
  bucket: "product-images" | "category-images" | "brand-logos" | "site-media",
  path: string,
): string {
  if (process.env.MEDIA_STORAGE_WRITE_TARGET === "r2") {
    const baseUrl = process.env.NEXT_PUBLIC_MEDIA_BASE_URL;
    if (!baseUrl) throw new Error("Переменная окружения NEXT_PUBLIC_MEDIA_BASE_URL не задана для Cloudflare R2.");
    return buildR2PublicUrl(baseUrl, bucket, path);
  }
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/**
 * Загрузка варианта, безопасная к повтору.
 *
 * Имя файла варианта — хеш его содержимого, поэтому объект по такому пути
 * либо отсутствует, либо байт-в-байт совпадает с тем, что мы собираемся
 * записать. Значит конфликт имени — это «уже загружено» (повторный
 * finalize, повторный проход backfill), а не расхождение: перезаписывать
 * нечего, и `upsert` остаётся выключенным, как требует план.
 */
export async function uploadImageVariant(supabase: AdminClient, variant: { path: string; body: Buffer }): Promise<void> {
  await uploadPublicMediaObject(supabase, {
    bucket: "product-images",
    path: variant.path,
    body: variant.body,
    contentType: VARIANT_UPLOAD_OPTIONS.contentType,
    cacheControl: VARIANT_UPLOAD_OPTIONS.cacheControl,
    allowExisting: true,
  });
}

// "normal"/"webp" arrive already finished — the client did the resizing and
// (for "webp") the re-encode before submitting (see compress-image.ts /
// ProductForm.tsx). Only the two script-processing modes have work left:
// the enhance-product-photo pipeline (crop to the alpha bounding box, tone
// correction, watermark), then an optional WebP re-encode of its output.
export async function applyPhotoMode(file: File, photoMode: ProductPhotoMode): Promise<File> {
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

export interface StagedImageRow {
  id: string;
  object_path: string;
  content_type: string;
}

/**
 * Обрабатывает одну фотографию из промежуточного хранилища и привязывает её к товару.
 * Повтор безопасен: идентификатор строки стабилен, поэтому master и варианты ложатся по тем же
 * путям, а уже созданная строка product_images не дублируется. Бросает ошибку при любом сбое.
 */
export async function attachStagedImageRow(options: {
  supabase: AdminClient;
  row: StagedImageRow;
  productId: string;
  productSlug: string;
  photoMode: ProductPhotoMode;
  order: number;
}): Promise<{ inserted: boolean }> {
  const { supabase, row, productId, productSlug, photoMode, order } = options;

  const downloaded = await supabase.storage.from(PRODUCT_IMAGE_STAGING_BUCKET).download(row.object_path);
  if (downloaded.error) throw downloaded.error;

  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const extension = CANONICAL_UPLOAD_EXTENSION[row.content_type];
  if (!extension) throw new Error(`Недопустимый тип файла: ${row.content_type}.`);

  // Повторная проверка содержимого — та же, что и для прямой загрузки.
  const staging = new File([bytes], `staged.${extension}`, { type: row.content_type });
  await validateRasterImage(staging);

  // Обработка по выбранному режиму сохраняется: раньше она выполнялась до
  // отправки, теперь — здесь, где у сервера есть исходные байты.
  const processed = await applyPhotoMode(staging, photoMode);
  const validated = await validateRasterImage(processed);

  // Идентификатор staging-строки стабилен между повторами finalize,
  // поэтому и master, и варианты ложатся по одним и тем же путям —
  // повторный проход не плодит дубликаты объектов.
  const publicPath = `${productSlug}/${row.id}/master.${validated.extension}`;
  const masterUrl = await uploadPublicMediaObject(supabase, {
    bucket: "product-images",
    path: publicPath,
    body: validated.bytes,
    contentType: validated.contentType,
    cacheControl: "31536000",
    allowExisting: true,
  });

  const { thumbnail, gallery } = await generateProductImageVariants(Buffer.from(validated.bytes), {
    productSlug,
    imageId: row.id,
  });
  for (const variant of [thumbnail, gallery]) {
    await uploadImageVariant(supabase, variant);
  }

  const publicUrl = (path: string) => mediaUrlForCurrentWriteTarget(supabase, "product-images", path);

  const { data: already } = await supabase.from("product_images").select("id").eq("url", masterUrl).maybeSingle();

  let inserted = false;
  if (!already) {
    const { error: insertError } = await supabase.from("product_images").insert({
      product_id: productId,
      url: masterUrl,
      thumbnail_url: publicUrl(thumbnail.path),
      gallery_url: publicUrl(gallery.path),
      order,
    });
    if (insertError) throw insertError;
    inserted = true;
  }

  await supabase.rpc("finalize_product_image_staging", { p_id: row.id });
  await supabase.storage.from(PRODUCT_IMAGE_STAGING_BUCKET).remove([row.object_path]);
  return { inserted };
}

export function describeStagedImageFailure(error: unknown): string {
  return getErrorMessage(error, "неизвестная ошибка");
}
