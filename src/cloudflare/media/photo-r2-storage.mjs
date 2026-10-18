/** Private R2 S3 boundary for the external Node/Sharp runner, never the request Worker. */
import { createHash } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const MAX_BYTES = 8 * 1024 * 1024;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SOURCE = new RegExp(`^product-image-staging/${UUID}/${UUID}/source\\.(?:jpg|png|webp|avif)$`);
const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
// Gallery v2 (1200px) is the current profile; v1 (1600px) stays allowed because older photos still point at it.
// Note: this Cloudflare media-jobs pipeline is not in use (product_media_jobs has never had a row); its database
// function finish_product_media_job still builds v1 gallery paths and needs a migration before it is switched on.
const FINAL = new RegExp(`^product-images/${SLUG}/${UUID}/(?:master\\.(?:jpg|png|webp|avif)|variants/(?:v2/thumbnail|v[12]/gallery)-[a-f0-9]{16}\\.webp)$`);
const SHA = /^[a-f0-9]{64}$/;
const MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const digest = (body) => createHash("sha256").update(body).digest("hex");

export class PhotoStorageError extends Error {
  constructor(rule) {
    super("photo_storage_failed");
    this.name = "PhotoStorageError";
    this.code = "photo_storage_failed";
    this.rule = rule;
  }
}

function isStatus(error, code) {
  return error && typeof error === "object" && error.$metadata?.httpStatusCode === code;
}

function assertKey(key, pattern) {
  if (typeof key !== "string" || !pattern.test(key)) throw new PhotoStorageError("invalid_key");
}

/**
 * A configured S3Client is injected so account credentials never enter this
 * module or test output. Staging and public media must use distinct buckets.
 */
export function createR2PhotoStorage({ client, stagingBucket, publicBucket }) {
  const validBucket = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value);
  if (!client || typeof client.send !== "function" || !validBucket(stagingBucket)
    || !validBucket(publicBucket) || stagingBucket === publicBucket) {
    throw new PhotoStorageError("invalid_configuration");
  }
  return {
    async readSource(key) {
      assertKey(key, SOURCE);
      const signal = AbortSignal.timeout(20_000);
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: stagingBucket, Key: key }), { abortSignal: signal });
        if (typeof result.ContentLength === "number" && result.ContentLength > MAX_BYTES) throw new PhotoStorageError("source_too_large");
        if (!result.Body || typeof result.Body[Symbol.asyncIterator] !== "function") throw new PhotoStorageError("invalid_source");
        const chunks = [];
        let length = 0;
        for await (const chunk of result.Body) {
          length += chunk.byteLength;
          if (length > MAX_BYTES) throw new PhotoStorageError("source_too_large");
          chunks.push(Buffer.from(chunk));
        }
        if (length === 0) throw new PhotoStorageError("invalid_source");
        return Buffer.concat(chunks, length);
      } catch (error) {
        throw error instanceof PhotoStorageError ? error : new PhotoStorageError("request_failed");
      }
    },
    async putIfAbsent(key, { body, contentType, sha256 }) {
      assertKey(key, FINAL);
      if (!(body instanceof Uint8Array) || body.byteLength < 1 || body.byteLength > MAX_BYTES
        || !MIME.has(contentType) || !SHA.test(sha256) || digest(body) !== sha256
        || (key.includes("/variants/") && contentType !== "image/webp")) {
        throw new PhotoStorageError("invalid_output");
      }
      try {
        await client.send(new PutObjectCommand({
          Bucket: publicBucket, Key: key, Body: body, ContentLength: body.byteLength,
          ContentType: contentType, Metadata: { sha256 }, IfNoneMatch: "*",
        }), { abortSignal: AbortSignal.timeout(20_000) });
        return true;
      } catch (error) {
        if (isStatus(error, 412)) return false;
        throw new PhotoStorageError("request_failed");
      }
    },
    async head(key) {
      assertKey(key, FINAL);
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: publicBucket, Key: key }), { abortSignal: AbortSignal.timeout(20_000) });
        return { bytes: result.ContentLength, sha256: result.Metadata?.sha256, contentType: result.ContentType };
      } catch (error) {
        if (isStatus(error, 404)) return null;
        throw new PhotoStorageError("request_failed");
      }
    },
  };
}
