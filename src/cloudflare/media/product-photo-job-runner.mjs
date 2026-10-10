/** Node-only orchestration. The caller owns the DB lease and supplies private R2 ports. */
import { createHash } from "node:crypto";
import { processProductPhoto } from "./product-photo-processor.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_BYTES = 8 * 1024 * 1024;
const EXTENSION = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["image/avif", "avif"],
]);
const MODES = new Set(["normal", "webp", "script", "script-webp"]);
const PUBLIC_BASE = /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?(?:\/[a-zA-Z0-9_-]+)*$/;
const digest = (body) => createHash("sha256").update(body).digest("hex");

export class PhotoJobError extends Error {
  constructor(rule) {
    super("photo_job_failed");
    this.name = "PhotoJobError";
    this.code = "photo_job_failed";
    this.rule = rule;
  }
}

function validate(job, storage, jobs, publicBase) {
  if (!job || !UUID.test(job.id) || !UUID.test(job.draft_id) || !UUID.test(job.lease_token)
    || job.state !== "processing" || !SLUG.test(job.product_slug)
    || !MODES.has(job.mode) || !EXTENSION.has(job.content_type)
    || !SHA.test(job.source_sha256) || !Number.isSafeInteger(job.byte_size)
    || job.byte_size < 1 || job.byte_size > MAX_BYTES
    || job.source_key !== `product-image-staging/${job.draft_id}/${job.id}/source.${EXTENSION.get(job.content_type)}`
    || !PUBLIC_BASE.test(publicBase)
    || typeof storage?.readSource !== "function" || typeof storage?.putIfAbsent !== "function" || typeof storage?.head !== "function"
    || typeof jobs?.finish !== "function" || typeof jobs?.fail !== "function") {
    throw new PhotoJobError("invalid_job");
  }
}

function describeResult(job, prepared, kind) {
  const item = prepared[kind];
  const masterType = job.mode === "script" ? "image/png" : job.mode === "script-webp" ? "image/webp" : job.content_type;
  const masterExtension = EXTENSION.get(masterType);
  const expectedPath = kind === "master"
    ? `${job.product_slug}/${job.id}/master.${masterExtension}`
    : `${job.product_slug}/${job.id}/variants/${kind === "thumbnail" ? "v2" : "v1"}/${kind}-${item?.sha256?.slice(0, 16)}.webp`;
  if (!item || !(item.body instanceof Uint8Array) || item.bytes !== item.body.byteLength
    || item.bytes < 1 || item.bytes > MAX_BYTES || !SHA.test(item.sha256)
    || item.sha256 !== digest(item.body) || item.path !== expectedPath
    || item.contentType !== (kind === "master" ? masterType : "image/webp")) {
    throw new PhotoJobError("invalid_output");
  }
  return { body: item.body, path: item.path, contentType: item.contentType, bytes: item.bytes, sha256: item.sha256 };
}

/**
 * @param {{job: object, storage: {readSource: Function, putIfAbsent: Function, head: Function},
 *   jobs: {finish: Function, fail: Function}, publicBase: string}} request
 * @returns {Promise<string>} finalized job id
 */
export async function runClaimedPhotoJob({ job, storage, jobs, publicBase }) {
  validate(job, storage, jobs, publicBase);
  try {
    const input = await storage.readSource(job.source_key);
    if (!(input instanceof Uint8Array) || input.byteLength !== job.byte_size || digest(input) !== job.source_sha256) {
      throw new PhotoJobError("source_mismatch");
    }
    const prepared = await processProductPhoto({
      input, contentType: job.content_type, mode: job.mode, productSlug: job.product_slug, imageId: job.id,
    });
    if (prepared.inputSha256 !== job.source_sha256) throw new PhotoJobError("source_mismatch");
    const outputs = Object.fromEntries(["master", "thumbnail", "gallery"].map((kind) => [kind, describeResult(job, prepared, kind)]));
    const receipt = { inputSha256: job.source_sha256 };
    for (const kind of ["master", "thumbnail", "gallery"]) {
      const item = outputs[kind];
      const key = `product-images/${item.path}`;
      // putIfAbsent must use a conditional create; an existing key is safe
      // only when HEAD confirms exactly the bytes and type we expected.
      await storage.putIfAbsent(key, { body: item.body, contentType: item.contentType, sha256: item.sha256 });
      const saved = await storage.head(key);
      if (!saved || saved.bytes !== item.bytes || saved.sha256 !== item.sha256 || saved.contentType !== item.contentType) {
        throw new PhotoJobError("object_unverified");
      }
      receipt[kind] = { path: item.path, contentType: item.contentType, bytes: item.bytes, sha256: item.sha256 };
    }
    if (await jobs.finish({ id: job.id, token: job.lease_token, receipt, publicBase }) !== job.id) {
      throw new PhotoJobError("finalize_unconfirmed");
    }
    return job.id;
  } catch (error) {
    // Finalization may have committed before a response was lost; the DB port
    // will reject fail() in that case. Never delete final objects here.
    try { await jobs.fail({ id: job.id, token: job.lease_token, retry: true }); } catch { /* reconciled by the next DB read */ }
    throw error instanceof PhotoJobError ? error : new PhotoJobError("job_execution_failed");
  }
}

/** Process at most one queued photo; no polling or scheduler is hidden here. */
export async function runNextPhotoJob({ jobs, storage, publicBase, leaseSeconds = 300 }) {
  // Check every required port before taking a DB lease, so an invalid worker
  // does not strand a job in processing until that lease expires.
  if (typeof jobs?.claim !== "function" || typeof jobs?.finish !== "function" || typeof jobs?.fail !== "function"
    || typeof storage?.readSource !== "function" || typeof storage?.putIfAbsent !== "function"
    || typeof storage?.head !== "function" || !PUBLIC_BASE.test(publicBase)
    || !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 5 || leaseSeconds > 600) {
    throw new PhotoJobError("invalid_configuration");
  }
  let job;
  try {
    job = await jobs.claim(leaseSeconds);
  } catch {
    throw new PhotoJobError("claim_failed");
  }
  if (job === null) return null;
  return runClaimedPhotoJob({ job, jobs, storage, publicBase });
}
