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
const SKIP_BELOW_BYTES = 300_000;

export async function compressImage(file: File): Promise<File> {
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
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;

    const newName = file.name.replace(/\.[^./]+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

// Lets a plain (uncontrolled) <input type="file"> used inside a native
// <form action={serverAction}> get the compressed file too, without having
// to intercept form submission — replaces the input's FileList in place so
// whatever reads it next (including the native submit) sees the compressed
// version.
export async function compressFileInput(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  if (!file) return;
  const compressed = await compressImage(file);
  if (compressed === file) return;

  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(compressed);
  input.files = dataTransfer.files;
}
