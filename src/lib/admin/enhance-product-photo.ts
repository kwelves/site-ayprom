import sharp from "sharp";
import { enhancePhotoBuffer, DEFAULT_ENHANCE_OPTIONS } from "./enhance-product-photo.core.mjs";

const WEBP_QUALITY = 82;

/**
 * Runs the same catalog-photo pipeline as `scripts/enhance-product-photos.mjs`
 * (tone correction, highlight recovery, adaptive sharpen, alpha-bbox crop,
 * square canvas, diagonal watermark) against an in-memory buffer instead of a
 * file path — used by the admin "upload via script" photo modes. See
 * enhance-product-photo.core.mjs for the shared implementation.
 */
export async function enhanceProductPhotoBuffer(input: Buffer): Promise<Buffer> {
  return enhancePhotoBuffer(input, DEFAULT_ENHANCE_OPTIONS);
}

/** Re-encodes a buffer to WebP — the shared final step for both the "+ WebP"
 * photo modes (plain re-compress, or on top of the enhance pipeline above). */
export async function convertBufferToWebp(input: Buffer, quality = WEBP_QUALITY): Promise<Buffer> {
  return sharp(input).webp({ quality }).toBuffer();
}
