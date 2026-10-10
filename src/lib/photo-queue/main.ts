import { createAdminClient } from "@/lib/supabase/admin";
import { attachStagedImageRow } from "@/lib/admin/product-image-attach";
import { MAX_PRODUCT_IMAGES } from "@/lib/admin/image-validation";
import { PRODUCT_IMAGE_STAGING_BUCKET } from "@/lib/admin/product-image-staging";
import { isProductPhotoMode, type ProductPhotoMode } from "@/lib/admin/product-photo-mode";
import { cleanupAbandonedStaging, runPhotoQueue, type QueueJob, type QueuePorts } from "./runner";
import { isPublicationEnabled, requestPublicationWorker } from "./enqueue";

// Entry point of the background photo worker (a GitHub Actions job, or a local process with --watch).
// It reads the queue from Supabase and writes finished photos to the media storage, using the same
// environment variables as the admin: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and, for R2,
// MEDIA_STORAGE_WRITE_TARGET and the R2_* variables.
const LEASE_SECONDS = 300;
const BUDGET_MS = 12 * 60 * 1000;
const EXPECTED_JOB_MS = 60 * 1000;
const WATCH_POLL_MS = 1500;
const CLEANUP_EVERY_MS = 10 * 60 * 1000;

const supabase = createAdminClient();

const ports: QueuePorts = {
  async claim() {
    const { data, error } = await supabase.rpc("claim_queued_product_image_staging", { p_lease_seconds: LEASE_SECONDS });
    if (error) throw error;
    return ((data ?? []) as QueueJob[])[0] ?? null;
  },
  async productInfo(productId) {
    const { data } = await supabase.from("products").select("slug").eq("id", productId).maybeSingle();
    if (!data) return null;
    const { count } = await supabase.from("product_images").select("id", { count: "exact", head: true }).eq("product_id", productId);
    return { slug: data.slug, imageCount: count ?? 0 };
  },
  async attach(job, info) {
    const mode: ProductPhotoMode = job.queued_photo_mode && isProductPhotoMode(job.queued_photo_mode) ? job.queued_photo_mode : "normal";
    return attachStagedImageRow({
      supabase,
      row: { id: job.id, object_path: job.object_path, content_type: job.content_type },
      productId: job.queued_product_id as string,
      productSlug: info.slug,
      photoMode: mode,
      order: info.imageCount,
    });
  },
  async fail(id, retry) {
    await supabase.rpc("fail_queued_product_image_staging", { p_id: id, p_retry: retry });
  },
};

async function cleanup(): Promise<number> {
  return cleanupAbandonedStaging({
    async list() {
      const { data, error } = await supabase.rpc("list_abandoned_product_image_staging", { p_limit: 100 });
      if (error) throw error;
      return (data ?? []) as Array<{ out_id: string; out_object_path: string }>;
    },
    async removeFiles(paths) {
      const { error } = await supabase.storage.from(PRODUCT_IMAGE_STAGING_BUCKET).remove(paths);
      if (error) throw error;
    },
    async release(ids) {
      const { error } = await supabase.rpc("release_product_image_staging", { p_ids: ids });
      if (error) throw error;
    },
  });
}

async function main() {
  const watch = process.argv.includes("--watch");
  let lastCleanup = 0;
  do {
    const result = await runPhotoQueue(ports, { now: Date.now, deadlineMs: BUDGET_MS, expectedJobMs: EXPECTED_JOB_MS, maxImages: MAX_PRODUCT_IMAGES });
    if (result.processed || result.failed) console.log(`[photo-queue] processed=${result.processed} failed=${result.failed} stopped=${result.stopped}`);
    // Finished photos are new content: ask for a publication so they reach the public site.
    if (result.processed > 0 && isPublicationEnabled()) await requestPublicationWorker();
    if (Date.now() - lastCleanup >= CLEANUP_EVERY_MS || !watch) {
      lastCleanup = Date.now();
      try {
        const removed = await cleanup();
        if (removed) console.log(`[photo-queue] removed ${removed} abandoned staged files`);
      } catch (error) {
        console.error(`[photo-queue] cleanup failed: ${error instanceof Error ? error.name : typeof error}`);
      }
    }
    if (watch) await new Promise((resolve) => setTimeout(resolve, WATCH_POLL_MS));
  } while (watch);
}

main().catch((error) => {
  console.error(`[photo-queue] stopped: ${error instanceof Error ? error.name : typeof error}`);
  process.exit(1);
});
