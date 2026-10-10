// Background worker of the photo queue: takes waiting photos one at a time and turns each into a product
// photo (see product-image-attach.ts). Pure orchestration over injected ports, so it can be tested
// without a database or Sharp; main.ts connects the real ones.
export interface QueueJob {
  id: string;
  object_path: string;
  content_type: string;
  queued_product_id: string | null;
  queued_photo_mode: string | null;
  attempts: number;
}

export interface ProductInfo {
  slug: string;
  imageCount: number;
}

export interface QueuePorts {
  claim(): Promise<QueueJob | null>;
  productInfo(productId: string): Promise<ProductInfo | null>;
  attach(job: QueueJob, info: ProductInfo): Promise<{ inserted: boolean }>;
  fail(id: string, retry: boolean): Promise<void>;
}

export interface RunOptions {
  now: () => number;
  /** Time budget in milliseconds from the start of the run; the loop stops when the next photo may not fit. */
  deadlineMs: number;
  /** Rough time one photo needs; used to avoid starting a photo that would run past the budget. */
  expectedJobMs?: number;
  /** A product may hold this many photos; a photo that would exceed it is turned down for good. */
  maxImages?: number;
}

export interface RunResult {
  processed: number;
  failed: number;
  stopped: "empty" | "deadline";
}

export async function runPhotoQueue(ports: QueuePorts, options: RunOptions): Promise<RunResult> {
  const startedAt = options.now();
  const reserve = options.expectedJobMs ?? 0;
  let processed = 0;
  let failed = 0;
  for (;;) {
    if (options.now() - startedAt + reserve >= options.deadlineMs) return { processed, failed, stopped: "deadline" };
    const job = await ports.claim();
    if (!job) return { processed, failed, stopped: "empty" };

    const info = job.queued_product_id ? await ports.productInfo(job.queued_product_id) : null;
    if (!info) {
      // The product was deleted while the photo waited: there is nothing to attach it to.
      failed += 1;
      await ports.fail(job.id, false);
      continue;
    }
    if (options.maxImages !== undefined && info.imageCount >= options.maxImages) {
      failed += 1;
      await ports.fail(job.id, false);
      continue;
    }
    try {
      await ports.attach(job, info);
      processed += 1;
    } catch (error) {
      failed += 1;
      // Only the error class is logged: messages can contain paths or other internal details.
      console.error(`[photo-queue] photo ${job.id} failed (attempt ${job.attempts}): ${error instanceof Error ? error.name : typeof error}`);
      await ports.fail(job.id, true);
    }
  }
}

export interface CleanupPorts {
  list(): Promise<Array<{ out_id: string; out_object_path: string }>>;
  removeFiles(paths: string[]): Promise<void>;
  release(ids: string[]): Promise<void>;
}

/**
 * Removes abandoned staged files. The files go first and the records only afterwards: a record
 * freed before its file is gone would leave a file nobody knows about.
 */
export async function cleanupAbandonedStaging(ports: CleanupPorts): Promise<number> {
  const rows = await ports.list();
  if (rows.length === 0) return 0;
  await ports.removeFiles(rows.map((row) => row.out_object_path));
  await ports.release(rows.map((row) => row.out_id));
  return rows.length;
}
