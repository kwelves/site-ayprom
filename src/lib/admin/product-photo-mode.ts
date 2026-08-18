// Shared between the server component that reads the persisted choice
// (products/new/page.tsx) and the client form that writes it back
// (ProductForm.tsx) — kept isomorphic (no "use client"/"use server") so both
// sides import the exact same type and validation.

export type ProductPhotoMode = "normal" | "webp" | "script" | "script-webp";

export const PRODUCT_PHOTO_MODE_COOKIE = "admin_photo_mode";
// Not a session/auth cookie — just a remembered UI preference, so it carries
// no signature (compare src/lib/admin/session.ts) and is fine to read/write
// from client code.
export const PRODUCT_PHOTO_MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const DEFAULT_PRODUCT_PHOTO_MODE: ProductPhotoMode = "normal";

const VALID_MODES: readonly ProductPhotoMode[] = ["normal", "webp", "script", "script-webp"];

export function isProductPhotoMode(value: string | undefined | null): value is ProductPhotoMode {
  return !!value && (VALID_MODES as readonly string[]).includes(value);
}

/** Modes where the server runs the full enhance-product-photo pipeline
 * (crop to the alpha bounding box, tone correction, watermark) instead of
 * just storing the client-compressed file as-is. */
export function usesScriptProcessing(mode: ProductPhotoMode): boolean {
  return mode === "script" || mode === "script-webp";
}

/** Modes whose final stored file should be WebP. */
export function usesWebpOutput(mode: ProductPhotoMode): boolean {
  return mode === "webp" || mode === "script-webp";
}
