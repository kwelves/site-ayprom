import { preload } from "react-dom";

const MAX_PRELOADED_PHOTOS = 12;

/**
 * Server-side resource hints for a product gallery. The first photo is already fetched with high priority
 * by the gallery itself; every other photo is requested at low priority straight from the HTML head, so by
 * the time a visitor clicks a thumbnail the file is usually in the browser cache (switching in a few ms).
 * A hint can never break the page.
 */
export function preloadGalleryImages(images: readonly { url: string }[]): void {
  const seen = new Set<string>(images[0]?.url ? [images[0].url] : []);
  for (const image of images.slice(1)) {
    if (seen.size > MAX_PRELOADED_PHOTOS) break;
    if (!image.url || seen.has(image.url)) continue;
    seen.add(image.url);
    try { preload(image.url, { as: "image", fetchPriority: "low" }); } catch { /* hints are optional */ }
  }
}
