// Downsizes/re-encodes an image client-side before it's uploaded to Supabase
// Storage — phone-camera photos are routinely several MB / thousands of
// pixels wide, which makes both the admin's upload and every later visitor's
// page load slower than the actual product/category photo needs to be.
//
// Skips SVGs (brand logos — vector, "compressing" would just rasterize and
// break them) and files already small enough that compressing wouldn't help.
// Server-Action uploads must also stay below Vercel's 4.5 MB function payload
// ceiling. The file budget deliberately leaves roughly half a megabyte for
// multipart boundaries and the Server Action envelope.

import { hasAlphaChannel } from "@/lib/admin/image-validation";

const MAX_DIMENSION = 1920;
const SKIP_BELOW_BYTES = 300_000;
const MIN_MULTIPART_HEADROOM_BYTES = 512 * 1024;

export const SERVER_ACTION_BODY_LIMIT_BYTES = 4 * 1024 * 1024;
export const MAX_SERVER_ACTION_FILE_BYTES = SERVER_ACTION_BODY_LIMIT_BYTES - MIN_MULTIPART_HEADROOM_BYTES;

const DIMENSION_STEPS = [MAX_DIMENSION, 1600, 1280, 1024, 800] as const;
const QUALITY_STEPS = [0.82, 0.74, 0.66, 0.58] as const;

export type CompressOutputFormat = "image/jpeg" | "image/webp";

const FORMAT_EXTENSION: Record<CompressOutputFormat, string> = {
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function resolveCompressionOutputFormat(
  fileType: string,
  detectedAlpha: boolean | null,
  requested?: CompressOutputFormat,
): CompressOutputFormat {
  // A known alpha channel must never be flattened merely to satisfy a caller's
  // JPEG preference. AVIF alpha is intentionally reported as unknown by the
  // lightweight parser, so keep potentially-transparent AVIF/WebP in WebP too.
  const mayContainAlpha =
    detectedAlpha === true || (detectedAlpha === null && ["image/avif", "image/webp"].includes(fileType));
  if (mayContainAlpha) return "image/webp";
  return requested ?? (fileType === "image/webp" ? "image/webp" : "image/jpeg");
}

async function detectAlpha(file: File): Promise<boolean | null> {
  if (file.type === "image/jpeg") return false;
  return hasAlphaChannel(new Uint8Array(await file.arrayBuffer()), file.type);
}

function compressionError(): Error {
  return new Error(
    "Не удалось подготовить фотографию для загрузки. Попробуйте сохранить её как JPEG или WebP либо уменьшить разрешение.",
  );
}

function replaceInputFiles(input: HTMLInputElement, files: File[]): void {
  const dataTransfer = new DataTransfer();
  for (const file of files) dataTransfer.items.add(file);
  input.files = dataTransfer.files;
}

async function encodeCanvas(
  bitmap: ImageBitmap,
  maxDimension: number,
  outputFormat: CompressOutputFormat,
  quality: number,
): Promise<Blob | null> {
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // JPEG cannot represent transparency. WebP can, so its fresh transparent
  // canvas must remain untouched before drawing the source image.
  if (outputFormat === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);

  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputFormat, quality));
}

export async function compressImage(file: File, requestedFormat?: CompressOutputFormat): Promise<File> {
  if (file.type === "image/svg+xml" || file.size < SKIP_BELOW_BYTES) return file;

  let bitmap: ImageBitmap | null = null;
  try {
    const alpha = await detectAlpha(file);
    const outputFormat = resolveCompressionOutputFormat(file.type, alpha, requestedFormat);
    bitmap = await createImageBitmap(file);

    for (const maxDimension of DIMENSION_STEPS) {
      for (const quality of QUALITY_STEPS) {
        const blob = await encodeCanvas(bitmap, maxDimension, outputFormat, quality);
        if (!blob) continue;

        // First fitting candidate wins: the loops are ordered from the least
        // destructive profile to progressively smaller fallbacks.
        if (blob.size <= MAX_SERVER_ACTION_FILE_BYTES) {
          if (blob.size >= file.size && file.size <= MAX_SERVER_ACTION_FILE_BYTES) return file;
          const newName = file.name.replace(/\.[^./]+$/, "") + "." + FORMAT_EXTENSION[outputFormat];
          return new File([blob], newName, { type: outputFormat });
        }
      }
    }

    if (file.size <= MAX_SERVER_ACTION_FILE_BYTES) return file;
    throw compressionError();
  } catch {
    if (file.size <= MAX_SERVER_ACTION_FILE_BYTES) return file;
    throw compressionError();
  } finally {
    bitmap?.close();
  }
}

// Lets a plain (uncontrolled) <input type="file"> used inside a native
// <form action={serverAction}> get the compressed file too, without having
// to intercept form submission — replaces the input's FileList in place so
// whatever reads it next (including the native submit) sees the compressed
// version.
export async function compressFileInput(input: HTMLInputElement, outputFormat?: CompressOutputFormat): Promise<void> {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const compressed = await compressImage(file, outputFormat);
    if (compressed !== file) replaceInputFiles(input, [compressed]);
  } catch (error) {
    // These helpers are also used by native Server-Action forms whose change
    // handlers intentionally do not await. Surface a useful browser message
    // instead of allowing an oversized body to fail later with HTTP 413.
    input.value = "";
    input.setCustomValidity(error instanceof Error ? error.message : compressionError().message);
    input.reportValidity();
    queueMicrotask(() => input.setCustomValidity(""));
  }
}

// Same trick as compressFileInput, but for a `multiple` file input — used by
// the product create form's photo picker, since photos there are attached to
// the same submission as the rest of the row instead of uploaded separately.
export async function compressFileListInput(input: HTMLInputElement, outputFormat?: CompressOutputFormat): Promise<void> {
  const files = input.files;
  if (!files || files.length === 0) return;

  const compressed = await Promise.all(Array.from(files).map((file) => compressImage(file, outputFormat)));
  replaceInputFiles(input, compressed);
}
