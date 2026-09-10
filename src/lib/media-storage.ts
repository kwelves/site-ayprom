import "server-only";

import { createHash } from "node:crypto";
import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildR2ObjectKey,
  buildR2PublicUrl,
  locatePublicMediaObject,
  validateMediaObjectPath,
  type PublicMediaBucket,
} from "@/lib/media-storage-core";

type UploadBody = ArrayBuffer | ArrayBufferView;

export interface PublicMediaUpload {
  bucket: PublicMediaBucket;
  path: string;
  body: UploadBody;
  contentType: string;
  cacheControl?: string;
  allowExisting?: boolean;
}

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicBaseUrl: string;
}

function requireR2Value(name: keyof NodeJS.ProcessEnv): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Переменная окружения ${name} не задана для Cloudflare R2.`);
  }
  return value;
}

function r2Config(): R2Config {
  return {
    accountId: requireR2Value("R2_ACCOUNT_ID"),
    accessKeyId: requireR2Value("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireR2Value("R2_SECRET_ACCESS_KEY"),
    bucketName: requireR2Value("R2_BUCKET_NAME"),
    publicBaseUrl: requireR2Value("NEXT_PUBLIC_MEDIA_BASE_URL"),
  };
}

function writeTarget(): "supabase" | "r2" {
  const value = process.env.MEDIA_STORAGE_WRITE_TARGET?.trim() || "supabase";
  if (value !== "supabase" && value !== "r2") {
    throw new Error("MEDIA_STORAGE_WRITE_TARGET должен быть supabase или r2.");
  }
  return value;
}

function dualWriteSupabase(): boolean {
  return process.env.MEDIA_STORAGE_DUAL_WRITE_SUPABASE === "true";
}

let cachedR2Client: S3Client | null = null;
let cachedR2Identity = "";

function getR2Client(config: R2Config): S3Client {
  const identity = `${config.accountId}:${config.accessKeyId}`;
  if (cachedR2Client && cachedR2Identity === identity) return cachedR2Client;
  cachedR2Client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  cachedR2Identity = identity;
  return cachedR2Client;
}

function bodyBuffer(body: UploadBody): Buffer {
  if (Buffer.isBuffer(body)) return body;
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  return Buffer.from(body);
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === "NotFound" || candidate.name === "NoSuchKey" || candidate.$metadata?.httpStatusCode === 404;
}

function isPreconditionFailed(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412,
  );
}

async function assertExistingR2Object(
  client: S3Client,
  config: R2Config,
  key: string,
  size: number,
  sha256: string,
): Promise<boolean> {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: config.bucketName, Key: key }));
    if (head.ContentLength !== size || head.Metadata?.sha256 !== sha256) {
      throw new Error(`В R2 уже существует другой файл по пути ${key}.`);
    }
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function uploadR2Object(input: PublicMediaUpload): Promise<string> {
  const config = r2Config();
  const client = getR2Client(config);
  const path = validateMediaObjectPath(input.path);
  const key = buildR2ObjectKey(input.bucket, path);
  const bytes = bodyBuffer(input.body);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  if (await assertExistingR2Object(client, config, key, bytes.byteLength, sha256)) {
    if (!input.allowExisting) throw new Error(`Файл ${key} уже существует в R2.`);
    return buildR2PublicUrl(config.publicBaseUrl, input.bucket, path);
  }

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucketName,
        Key: key,
        Body: bytes,
        ContentLength: bytes.byteLength,
        ContentType: input.contentType,
        CacheControl: input.cacheControl ? `public, max-age=${input.cacheControl}, immutable` : undefined,
        Metadata: { sha256 },
        IfNoneMatch: "*",
      }),
    );
  } catch (error) {
    if (!isPreconditionFailed(error) || !(await assertExistingR2Object(client, config, key, bytes.byteLength, sha256))) {
      throw error;
    }
    if (!input.allowExisting) throw new Error(`Файл ${key} уже существует в R2.`);
  }

  if (!(await assertExistingR2Object(client, config, key, bytes.byteLength, sha256))) {
    throw new Error(`Не удалось подтвердить загрузку R2: ${key}`);
  }
  return buildR2PublicUrl(config.publicBaseUrl, input.bucket, path);
}

async function uploadSupabaseObject(
  supabase: SupabaseClient,
  input: PublicMediaUpload,
): Promise<string> {
  const path = validateMediaObjectPath(input.path);
  const { error } = await supabase.storage.from(input.bucket).upload(path, bodyBuffer(input.body), {
    contentType: input.contentType,
    cacheControl: input.cacheControl,
    upsert: false,
  });
  if (error) {
    const alreadyExists = error.message.toLowerCase().includes("already exists") || error.message.toLowerCase().includes("duplicate");
    if (!input.allowExisting || !alreadyExists) throw error;
    const existing = await supabase.storage.from(input.bucket).download(path);
    if (existing.error) throw existing.error;
    const existingBytes = Buffer.from(await existing.data.arrayBuffer());
    if (!existingBytes.equals(bodyBuffer(input.body))) throw new Error(`В Supabase уже существует другой файл по пути ${path}.`);
  }
  return supabase.storage.from(input.bucket).getPublicUrl(path).data.publicUrl;
}

async function removeR2Keys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const config = r2Config();
  const result = await getR2Client(config).send(
    new DeleteObjectsCommand({
      Bucket: config.bucketName,
      Delete: { Objects: [...new Set(keys)].map((Key) => ({ Key })), Quiet: true },
    }),
  );
  if (result.Errors?.length) throw new Error(`R2 не удалил ${result.Errors.length} объектов.`);
}

export async function uploadPublicMediaObject(
  supabase: SupabaseClient,
  input: PublicMediaUpload,
): Promise<string> {
  if (writeTarget() === "supabase") return uploadSupabaseObject(supabase, input);
  const journalBucket = requireR2Value("MEDIA_STORAGE_JOURNAL_BUCKET");
  const { data: journal, error: journalLookupError } = await supabase.storage.getBucket(journalBucket);
  if (journalLookupError) throw journalLookupError;
  if (!journal || journal.public) throw new Error("Журнал переноса должен храниться в закрытом bucket Supabase.");
  const r2Url = await uploadR2Object(input);
  try {
    const backupUrl = dualWriteSupabase()
      ? await uploadSupabaseObject(supabase, { ...input, allowExisting: true })
      : null;
    const bytes = bodyBuffer(input.body);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const key = buildR2ObjectKey(input.bucket, input.path);
    // Private durable receipts survive Vercel restarts and DB insert failures.
    // Current DB rows remain the source of truth for live/deleted references.
    const receipt = JSON.stringify({ key, r2Url, backupUrl, sha256: digest, size: bytes.byteLength });
    const { error: journalError } = await supabase.storage.from(journalBucket).upload(
      `${key}/${digest}.json`, Buffer.from(receipt),
      { contentType: "application/json", upsert: true },
    );
    if (journalError) throw journalError;
    return r2Url;
  } catch (error) {
    // A retry may have reused an object referenced by an already saved row.
    // Retain it for reconciliation instead of deleting a potentially live file.
    throw error;
  }
}

export async function removePublicMediaUrls(
  supabase: SupabaseClient,
  bucket: PublicMediaBucket,
  urls: Array<string | null | undefined>,
): Promise<void> {
  // Migration and observation preserve originals in both providers. Cleanup
  // is enabled only by a separate, explicitly configured post-migration step.
  if (process.env.MEDIA_STORAGE_RETAIN_OBJECTS !== "false") return;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("Переменная окружения NEXT_PUBLIC_SUPABASE_URL не задана.");
  const r2PublicBaseUrl = process.env.NEXT_PUBLIC_MEDIA_BASE_URL?.trim();
  const located = urls
    .filter((url): url is string => Boolean(url))
    .map((publicUrl) => locatePublicMediaObject({ publicUrl, bucket, supabaseUrl, r2PublicBaseUrl }))
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const supabasePaths = new Set<string>();
  const r2Keys = new Set<string>();
  for (const item of located) {
    if (item.provider === "supabase") supabasePaths.add(item.path);
    if (item.provider === "r2") {
      r2Keys.add(item.key);
      // R2 writes can have a same-path Supabase safety copy during the
      // observation window. Remove it when the logical media item is deleted.
      supabasePaths.add(item.path);
    }
  }

  if (r2Keys.size > 0) await removeR2Keys([...r2Keys]);
  if (supabasePaths.size > 0) {
    const { error } = await supabase.storage.from(bucket).remove([...supabasePaths]);
    if (error) throw error;
  }
}
