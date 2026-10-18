import type { createAdminClient } from "@/lib/supabase/admin";
import { GALLERY_VARIANT, generateProductGalleryVariant } from "@/lib/admin/product-image-variants.core.mjs";
import { mediaUrlForCurrentWriteTarget, uploadImageVariant } from "@/lib/admin/product-image-attach";

// Moves the gallery photo of every existing product image to the current gallery profile (see GALLERY_VARIANT):
// the master is read from its public URL, a new gallery WebP is made from it, stored next to the old one and the
// row is pointed at it. Masters and old variants are never touched or removed, so one UPDATE brings an old link
// back, and links already cached by browsers keep working.
//
// Dry run by default: everything is computed and reported, nothing is written. Run from the photo-queue job
// (`runner.mjs --regenerate-gallery [--apply] [--limit=N]`), which has the storage keys of its environment.

type AdminClient = ReturnType<typeof createAdminClient>;

interface ImageRow {
  id: string;
  url: string;
  gallery_url: string | null;
}

export interface GalleryRegenerationOptions {
  apply: boolean;
  limit?: number;
  concurrency?: number;
  log?: (line: string) => void;
}

export interface GalleryRegenerationResult {
  pending: number;
  processed: number;
  updated: number;
  failed: number;
  newBytes: number;
}

const CURRENT_MARKER = `/variants/${GALLERY_VARIANT.profileVersion}/gallery-`;

/** Product slug and image folder of an existing variant URL: the new variant goes into the same folder. */
export function galleryTargetFromUrl(url: string): { productSlug: string; imageId: string } | null {
  const match = /\/product-images\/([^/]+)\/([^/]+)\/variants\//.exec(url);
  return match ? { productSlug: decodeURIComponent(match[1]), imageId: match[2] } : null;
}

export function needsGalleryRegeneration(row: Pick<ImageRow, "gallery_url">): boolean {
  return !row.gallery_url || !row.gallery_url.includes(CURRENT_MARKER);
}

async function listPendingRows(supabase: AdminClient): Promise<ImageRow[]> {
  const rows: ImageRow[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("product_images")
      .select("id, url, gallery_url")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as ImageRow[]));
    if (!data || data.length < pageSize) break;
  }
  return rows.filter(needsGalleryRegeneration);
}

async function regenerateOne(supabase: AdminClient, row: ImageRow, apply: boolean): Promise<number> {
  const target = row.gallery_url ? galleryTargetFromUrl(row.gallery_url) : null;
  if (!target) throw new Error("no variant folder in gallery_url");

  const response = await fetch(row.url);
  if (!response.ok) throw new Error(`master HTTP ${response.status}`);
  const master = Buffer.from(await response.arrayBuffer());

  const { gallery } = await generateProductGalleryVariant(master, target);
  if (!apply) return gallery.bytes;

  await uploadImageVariant(supabase, gallery);
  const galleryUrl = mediaUrlForCurrentWriteTarget(supabase, "product-images", gallery.path);
  // Only if nobody changed the row meanwhile: a concurrent edit wins and is left alone.
  const { error } = await supabase
    .from("product_images")
    .update({ gallery_url: galleryUrl })
    .eq("id", row.id)
    .eq("gallery_url", row.gallery_url as string);
  if (error) throw error;
  return gallery.bytes;
}

export async function regenerateGalleryVariants(
  supabase: AdminClient,
  { apply, limit, concurrency = 3, log = console.log }: GalleryRegenerationOptions,
): Promise<GalleryRegenerationResult> {
  const pending = await listPendingRows(supabase);
  const queue = typeof limit === "number" && limit > 0 ? pending.slice(0, limit) : pending;
  log(`[gallery] profile ${GALLERY_VARIANT.profileVersion} ${GALLERY_VARIANT.maxSide}px q${GALLERY_VARIANT.quality}; to do: ${pending.length}, this run: ${queue.length}, ${apply ? "APPLY" : "dry run"}`);

  const result: GalleryRegenerationResult = { pending: pending.length, processed: 0, updated: 0, failed: 0, newBytes: 0 };
  let next = 0;
  async function worker() {
    while (next < queue.length) {
      const row = queue[next++];
      try {
        result.newBytes += await regenerateOne(supabase, row, apply);
        result.processed += 1;
        if (apply) result.updated += 1;
      } catch (error) {
        result.failed += 1;
        log(`[gallery] failed ${row.id}: ${error instanceof Error ? error.message : typeof error}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));

  const average = result.processed ? Math.round(result.newBytes / result.processed / 1024) : 0;
  log(`[gallery] processed=${result.processed} updated=${result.updated} failed=${result.failed} average new gallery=${average}KB`);
  return result;
}
