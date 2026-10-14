// Private external Node only (no Worker/Next import). Sharp stays in the existing processor;
// this module only places already-processed bytes under write-once, content-addressed keys
// and checks that every R2 object a release references is present before activation.
// There is intentionally no delete or overwrite operation in the store interface.
import { createHash } from "node:crypto";
import {
  PUBLIC_MEDIA_BUCKETS,
  buildR2ObjectKey,
  buildR2PublicUrl,
  locatePublicMediaObject,
  type PublicMediaBucket,
} from "../../lib/media-storage-core";

export interface MediaObjectStore {
  head(key: string): Promise<{ size: number; sha256: string | null } | null>;
  /** Must never replace an existing object: answer "exists" instead. */
  putIfAbsent(input: { key: string; bytes: Uint8Array; contentType: string; sha256: string }): Promise<"created" | "exists">;
}

const EXTENSIONS: Record<string, string> = {
  "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png",
  "image/avif": "avif", "image/gif": "gif", "image/svg+xml": "svg",
};
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_LEAVES = 500_000;
const MAX_DEPTH = 24;
const IMMUTABLE_KEY = /^[a-z][a-z-]*\/immutable\/([0-9a-f]{64})\.[a-z0-9]{2,5}$/;
const HEAD_CONCURRENCY = 8;
const invalid = () => new Error("media_invalid");
const conflict = () => new Error("media_conflict");

/** Stores bytes at `<bucket>/immutable/<sha256>.<ext>`. Same bytes -> same key (no second write);
 * changed bytes -> a new key. An unexpected object at a key is never replaced.
 */
export async function stageMedia(input: {
  store: MediaObjectStore;
  bucket: PublicMediaBucket;
  bytes: Uint8Array;
  contentType: string;
  publicBaseUrl: string;
}): Promise<{ immutableKey: string; sha256: string; publicUrl: string }> {
  const { store, bucket, bytes, contentType } = input;
  const extension = EXTENSIONS[contentType];
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES || !extension
    || !(PUBLIC_MEDIA_BUCKETS as readonly string[]).includes(bucket) || typeof store?.head !== "function"
    || typeof store.putIfAbsent !== "function") throw invalid();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const path = `immutable/${sha256}.${extension}`;
  let immutableKey: string, publicUrl: string;
  try {
    immutableKey = buildR2ObjectKey(bucket, path);
    publicUrl = buildR2PublicUrl(input.publicBaseUrl, bucket, path);
  } catch { throw invalid(); }
  const matches = (found: { size: number; sha256: string | null } | null) =>
    !!found && found.size === bytes.byteLength && found.sha256 === sha256;

  const existing = await store.head(immutableKey);
  if (existing) {
    if (!matches(existing)) throw conflict();
    return { immutableKey, sha256, publicUrl };
  }
  await store.putIfAbsent({ key: immutableKey, bytes, contentType, sha256 });
  const confirmed = await store.head(immutableKey);
  if (!confirmed) throw new Error("media_unconfirmed");
  if (!matches(confirmed)) throw conflict();
  return { immutableKey, sha256, publicUrl };
}

/** Every string anywhere in the release documents that is a public URL of the configured R2 media
 * origin becomes its object key. Other origins (including legacy Supabase storage) are ignored.
 */
export function collectReleaseMediaKeys(documents: unknown, options: { publicBaseUrl: string }): string[] {
  const keys = new Set<string>();
  let leaves = 0;
  const walk = (value: unknown, depth: number) => {
    if (depth > MAX_DEPTH || leaves > MAX_LEAVES) throw invalid();
    if (typeof value === "string") {
      leaves += 1;
      if (value.length > 2048 || !/^https?:\/\//.test(value)) return;
      for (const bucket of PUBLIC_MEDIA_BUCKETS) {
        const found = locatePublicMediaObject({ publicUrl: value, bucket,
          supabaseUrl: "https://supabase.invalid", r2PublicBaseUrl: options.publicBaseUrl });
        if (found?.provider === "r2") { keys.add(found.key); return; }
      }
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) walk(item, depth + 1);
    }
  };
  walk(documents, 0);
  return [...keys].sort();
}

/** Fails closed: any unreadable reference list or store error is "not ok". Read-only (head only). */
export async function verifyReleaseMedia(input: {
  releaseId: string;
  references: { list(releaseId: string): Promise<string[]> };
  store: MediaObjectStore;
}): Promise<{ ok: boolean; missing: string[] }> {
  let keys: string[];
  try {
    keys = await input.references.list(input.releaseId);
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string" || key.length > 1024)) throw invalid();
  } catch { return { ok: false, missing: [] }; }
  const missing: string[] = [];
  let next = 0;
  const check = async (key: string) => {
    try {
      const found = await input.store.head(key);
      const embedded = IMMUTABLE_KEY.exec(key)?.[1];
      if (!found || (embedded !== undefined && found.sha256 !== embedded)) missing.push(key);
    } catch { missing.push(key); }
  };
  await Promise.all(Array.from({ length: Math.min(HEAD_CONCURRENCY, keys.length) }, async () => {
    while (next < keys.length) await check(keys[next++]);
  }));
  missing.sort();
  return { ok: missing.length === 0, missing };
}
