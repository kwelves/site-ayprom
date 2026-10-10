/**
 * Node-only processing boundary for the external media runner. Never import
 * this module from the request Worker. No filesystem, network, DB, or env IO.
 * Input is the upload AFTER the existing browser preparation: normal/webp
 * therefore preserve its bytes, just like the legacy admin action.
 * Native execution requires Node with TypeScript stripping (22.18+ / 24).
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { MAX_IMAGE_BYTES, validateRasterImage } from "../../lib/admin/image-validation.ts";
import { isProductPhotoMode, usesScriptProcessing, usesWebpOutput } from "../../lib/admin/product-photo-mode.ts";
import { enhanceProductPhotoBuffer, convertBufferToWebp } from "../../lib/admin/enhance-product-photo.ts";
import { generateProductImageVariants, MAX_SOURCE_PIXELS } from "../../lib/admin/product-image-variants.core.mjs";

const EXTENSIONS = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["image/avif", "avif"],
]);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class PhotoProcessingError extends Error {
  constructor(rule) {
    super("photo_processing_failed");
    this.name = "PhotoProcessingError";
    this.code = "photo_processing_failed";
    this.rule = rule;
  }
}

const sha256 = (body) => createHash("sha256").update(body).digest("hex");
const describe = (body, path, contentType) => ({ body, path, contentType, bytes: body.byteLength, sha256: sha256(body) });

/**
 * Builds all three complete objects before a caller can publish any of them.
 * productSlug/imageId must come from a server-owned job, not an upload name.
 * This is not an authenticated upload endpoint or a job/lease implementation.
 * Errors intentionally omit original names, bytes, paths and decoder details.
 * @param {{ input: Uint8Array, contentType: string, mode: string, productSlug: string, imageId: string }} request
 */
export async function processProductPhoto(request) {
  if (!request || !(request.input instanceof Uint8Array)
    || request.input.byteLength === 0 || request.input.byteLength > MAX_IMAGE_BYTES
    || typeof request.productSlug !== "string" || !SLUG.test(request.productSlug)
    || typeof request.imageId !== "string" || !UUID.test(request.imageId)
    || !isProductPhotoMode(request.mode) || !EXTENSIONS.has(request.contentType)) {
    throw new PhotoProcessingError("invalid_input");
  }
  // Snapshot both metadata and bytes before yielding: a caller cannot change
  // identity/mode/input halfway through processing and invalidate the receipt.
  const { contentType, mode, productSlug, imageId } = request;
  const input = Buffer.from(request.input);
  let validated;
  try {
    validated = await validateRasterImage(new File([input], `input.${EXTENSIONS.get(contentType)}`, { type: contentType }));
    // Header sniffing alone does not catch animations. Reject them BEFORE the
    // enhancement pipeline can flatten the first frame into an ordinary PNG.
    const metadata = await sharp(input, { limitInputPixels: MAX_SOURCE_PIXELS }).metadata();
    if ((metadata.pages ?? 1) !== 1) throw new Error("multiple_frames");
  } catch {
    throw new PhotoProcessingError("invalid_image");
  }

  try {
    let master = input;
    if (usesScriptProcessing(mode)) {
      master = await enhanceProductPhotoBuffer(input);
      if (usesWebpOutput(mode)) master = await convertBufferToWebp(master);
      const type = usesWebpOutput(mode) ? "image/webp" : "image/png";
      validated = await validateRasterImage(new File([master], `master.${EXTENSIONS.get(type)}`, { type }));
    }
    const { thumbnail, gallery } = await generateProductImageVariants(master, { productSlug, imageId });
    return {
      profile: "legacy-product-photo-v1",
      mode,
      inputSha256: sha256(input),
      master: describe(master, `${productSlug}/${imageId}/master.${validated.extension}`, validated.contentType),
      thumbnail: describe(thumbnail.body, thumbnail.path, "image/webp"),
      gallery: describe(gallery.body, gallery.path, "image/webp"),
    };
  } catch {
    throw new PhotoProcessingError("processing_failed");
  }
}
