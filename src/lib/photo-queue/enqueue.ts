import type { createAdminClient } from "@/lib/supabase/admin";
import type { ProductPhotoMode } from "@/lib/admin/product-photo-mode";
import { MAX_PRODUCT_IMAGES } from "@/lib/admin/image-validation";
import { CANONICAL_UPLOAD_EXTENSION, PRODUCT_IMAGE_STAGING_BUCKET, STAGING_RETENTION_SECONDS, buildStagingObjectPath } from "@/lib/admin/product-image-staging";

// Cloudflare admin side of the photo queue: put chosen photos in the queue and wake the background
// worker (a GitHub Actions workflow). The worker itself lives in ./runner.ts.
type AdminClient = ReturnType<typeof createAdminClient>;
type Env = Record<string, string | undefined>;

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORKFLOW_FILE = /^[A-Za-z0-9_.-]+\.ya?ml$/;
const GIT_REF = /^[A-Za-z0-9_./-]{1,100}$/;
const GITHUB_ENVIRONMENT = /^(staging|production)$/;

export function isPhotoQueueMode(env: Env = process.env): boolean {
  return env.PHOTO_PROCESSING === "queue";
}

/** Starts a GitHub workflow. Returns false (never throws): a missed wake-up must not break saving. */
async function dispatchWorkflow(
  env: Env,
  names: { file: string; ref: string },
  label: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const token = env.GITHUB_DISPATCH_TOKEN?.trim();
  const repository = env.GITHUB_REPOSITORY?.trim();
  const workflow = env[names.file]?.trim();
  const ref = env[names.ref]?.trim() || "main";
  if (!token || !repository || !workflow) return false;
  if (!REPOSITORY.test(repository) || repository.includes("..") || !WORKFLOW_FILE.test(workflow) || !GIT_REF.test(ref) || ref.includes("..")) {
    console.error(`[${label}] invalid worker configuration`);
    return false;
  }
  // Which GitHub environment (staging or production) the workflow runs in, with that environment's own secrets.
  // Sent only when configured: a workflow file that does not declare the input would refuse the request.
  const environment = env.WORKFLOW_ENVIRONMENT?.trim();
  if (environment && !GITHUB_ENVIRONMENT.test(environment)) {
    console.error(`[${label}] invalid worker configuration`);
    return false;
  }
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "ayprom-admin",
        "content-type": "application/json",
      },
      body: JSON.stringify(environment ? { ref, inputs: { environment } } : { ref }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) console.error(`[${label}] worker start refused: ${response.status}`);
    return response.ok;
  } catch (error) {
    // The message is not logged: network errors can echo request details.
    console.error(`[${label}] worker start failed: ${error instanceof Error ? error.name : typeof error}`);
    return false;
  }
}

/** Starts the photo workflow. */
export function requestPhotoWorker(env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  return dispatchWorkflow(env, { file: "PHOTO_WORKFLOW_FILE", ref: "PHOTO_WORKFLOW_REF" }, "photo-queue", fetchImpl);
}

/** Cloudflare admin: edits reach the public site through a published snapshot, built by this workflow. */
export function isPublicationEnabled(env: Env = process.env): boolean {
  return Boolean(env.PUBLICATION_WORKFLOW_FILE?.trim());
}

/** Starts the publication workflow. */
export function requestPublicationWorker(env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  return dispatchWorkflow(env, { file: "PUBLICATION_WORKFLOW_FILE", ref: "PUBLICATION_WORKFLOW_REF" }, "publication", fetchImpl);
}

/** Marks staged photos as waiting for the worker. Returns how many were queued. */
export async function queueStagedImages(
  supabase: AdminClient,
  input: { draftId: string; stagingIds: string[]; productId: string; photoMode: ProductPhotoMode },
  wake: () => Promise<boolean> = () => requestPhotoWorker(),
): Promise<number> {
  const { data, error } = await supabase.rpc("queue_product_image_staging", {
    p_draft: input.draftId,
    p_ids: input.stagingIds,
    p_product: input.productId,
    p_mode: input.photoMode,
  });
  if (error) throw error;
  const queued = typeof data === "number" ? data : 0;
  if (queued > 0) await wake();
  return queued;
}

/**
 * Edit mode: one photo added to an existing product. The file is kept in private staging like in the
 * create flow, registered, and queued for the product. Returns the id the form tracks as "pending".
 */
export async function stageAndQueueFile(
  supabase: AdminClient,
  input: { productId: string; file: File },
  wake: () => Promise<boolean> = () => requestPhotoWorker(),
): Promise<{ pending: true; id: string }> {
  const extension = CANONICAL_UPLOAD_EXTENSION[input.file.type];
  if (!extension) throw new Error("Фотография должна быть JPEG, PNG, WebP или AVIF.");

  const draftId = crypto.randomUUID();
  const objectPath = buildStagingObjectPath(draftId, crypto.randomUUID(), extension);
  const { data: claim, error: claimError } = await supabase
    .rpc("claim_product_image_staging", {
      p_draft_id: draftId,
      p_object_path: objectPath,
      p_content_type: input.file.type,
      p_byte_size: input.file.size,
      p_ttl_seconds: STAGING_RETENTION_SECONDS,
      p_max_files: MAX_PRODUCT_IMAGES,
    })
    .single<{ out_id: string; out_expires_at: string }>();
  if (claimError) throw claimError;

  const { error: uploadError } = await supabase.storage
    .from(PRODUCT_IMAGE_STAGING_BUCKET)
    .upload(objectPath, new Uint8Array(await input.file.arrayBuffer()), { contentType: input.file.type, upsert: false });
  if (uploadError) {
    await supabase.rpc("release_product_image_staging", { p_ids: [claim.out_id] });
    throw uploadError;
  }

  await queueStagedImages(supabase, { draftId, stagingIds: [claim.out_id], productId: input.productId, photoMode: "normal" }, wake);
  return { pending: true, id: claim.out_id };
}
