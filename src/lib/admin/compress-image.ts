// Downsizes/re-encodes an image client-side before it's uploaded to Supabase
// Storage — phone-camera photos are routinely several MB / thousands of
// pixels wide, which makes both the admin's upload and every later visitor's
// page load slower than the actual product/category photo needs to be.
//
// Skips SVGs (brand logos — vector, "compressing" would just rasterize and
// break them) and files already small enough that compressing wouldn't help.
// Falls back to the original file on any failure or if the "compressed"
// result isn't actually smaller — never blocks an upload on this being
// unavailable (e.g. no canvas/createImageBitmap support).

const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.82;
const WEBP_QUALITY = 0.82;
const SKIP_BELOW_BYTES = 300_000;

export type CompressOutputFormat = "image/jpeg" | "image/webp";

const FORMAT_EXTENSION: Record<CompressOutputFormat, string> = {
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const FORMAT_QUALITY: Record<CompressOutputFormat, number> = {
  "image/jpeg": JPEG_QUALITY,
  "image/webp": WEBP_QUALITY,
};

export async function compressImage(file: File, outputFormat: CompressOutputFormat = "image/jpeg"): Promise<File> {
  if (file.type === "image/svg+xml" || file.size < SKIP_BELOW_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    // A fresh canvas defaults to transparent black. Neither JPEG nor the way
    // this catalog displays WebP output expects that, so it's baked to white
    // here regardless of target format — same reasoning as the JPEG-only
    // version this replaced, just no longer tied to one specific encoder.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outputFormat, FORMAT_QUALITY[outputFormat]),
    );
    if (!blob || blob.size >= file.size) return file;

    const newName = file.name.replace(/\.[^./]+$/, "") + "." + FORMAT_EXTENSION[outputFormat];
    return new File([blob], newName, { type: outputFormat });
  } catch {
    return file;
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
  const compressed = await compressImage(file, outputFormat);
  if (compressed === file) return;

  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(compressed);
  input.files = dataTransfer.files;
}

// Same trick as compressFileInput, but for a `multiple` file input — used by
// the product create form's photo picker, since photos there are attached to
// the same submission as the rest of the row instead of uploaded separately.
export async function compressFileListInput(input: HTMLInputElement, outputFormat?: CompressOutputFormat): Promise<void> {
  const files = input.files;
  if (!files || files.length === 0) return;

  const compressed = await Promise.all(Array.from(files).map((file) => compressImage(file, outputFormat)));
  const dataTransfer = new DataTransfer();
  for (const file of compressed) dataTransfer.items.add(file);
  input.files = dataTransfer.files;
}
