/**
 * Safe, resumable migration of public AYPROM media from Supabase Storage to
 * Cloudflare R2. The default command is inventory-only and never writes.
 *
 * Examples:
 *   npm run media:r2
 *   npm run media:r2 -- --scope=video --apply --confirm-project-ref=<ref> --confirm-r2-bucket=ayprom-media-production
 *   npm run media:r2 -- --scope=canary --apply --confirm-project-ref=<ref> --confirm-r2-bucket=ayprom-media-production
 *   npm run media:r2 -- --scope=all --apply --confirm-project-ref=<ref> --confirm-r2-bucket=ayprom-media-production
 *   npm run media:r2 -- --rollback --journal=<absolute-jsonl-path> --confirm-project-ref=<ref>
 */

import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

nextEnv.loadEnvConfig(process.cwd());

const args = new Set(process.argv.slice(2));
const valueArg = (name) => {
  const prefix = `--${name}=`;
  const match = [...args].find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length);
};

if (args.has("--help")) {
  console.log(`
AYPROM Supabase -> Cloudflare R2 media migration

No flags                         inventory only; no remote writes
--scope=video|canary|all         select migration scope (default: all)
--apply                          copy objects and CAS-update database URLs
--copy-only                      copy objects without database URL updates
--editing-paused                 confirm catalog edits are paused for URL updates
--backup-confirmed               confirm a readable database backup exists
--confirm-project-ref=<ref>      required with --apply/--rollback
--confirm-r2-bucket=<name>       required with --apply
--journal=<absolute-path>        optional JSONL journal path; required for rollback
--rollback                       restore old database URLs from a journal
--rollback-new                   restore current R2 uploads using private receipts

The script never deletes source objects. Concurrency is fixed at 2.
`);
  process.exit(0);
}

const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_SECRET_KEY = required("SUPABASE_SECRET_KEY");
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const APPLY = args.has("--apply");
const COPY_ONLY = args.has("--copy-only");
const ROLLBACK = args.has("--rollback");
const ROLLBACK_NEW = args.has("--rollback-new");
const SCOPE = valueArg("scope") ?? "all";
const CONFIRM_PROJECT_REF = valueArg("confirm-project-ref");
const JOURNAL_PATH = valueArg("journal") ?? path.join(
  tmpdir(),
  "ayprom-r2-migration",
  `${new Date().toISOString().replaceAll(":", "-")}-${ROLLBACK ? "rollback" : APPLY ? SCOPE : "inventory"}.jsonl`,
);

if (!["video", "canary", "all"].includes(SCOPE)) fail("--scope должен быть video, canary или all.");
if ((APPLY || ROLLBACK || ROLLBACK_NEW) && CONFIRM_PROJECT_REF !== PROJECT_REF) {
  fail("Подтверждение проекта не совпадает с NEXT_PUBLIC_SUPABASE_URL.");
}
if (ROLLBACK && APPLY) fail("--rollback и --apply нельзя использовать одновременно.");
if (ROLLBACK_NEW && (APPLY || ROLLBACK)) fail("--rollback-new нельзя сочетать с --apply или --rollback.");
if (ROLLBACK && !valueArg("journal")) fail("Для отката укажите существующий --journal=<absolute-path>.");
if (!path.isAbsolute(JOURNAL_PATH)) fail("Журнал должен иметь абсолютный путь вне репозитория.");
const journalRelative = path.relative(process.cwd(), JOURNAL_PATH);
if (!journalRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(journalRelative)) fail("Журнал нельзя сохранять в репозитории.");
if ((ROLLBACK || ROLLBACK_NEW || (APPLY && !COPY_ONLY)) && (!args.has("--editing-paused") || !args.has("--backup-confirmed"))) {
  fail("Перед обновлением ссылок нужны --editing-paused и --backup-confirmed. Для копирования используйте --copy-only.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`Переменная окружения ${name} не задана.`);
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function r2Settings() {
  const settings = {
    accountId: required("R2_ACCOUNT_ID"),
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    bucket: required("R2_BUCKET_NAME"),
    publicBaseUrl: required("NEXT_PUBLIC_MEDIA_BASE_URL").replace(/\/$/, ""),
  };
  if ((APPLY || ROLLBACK_NEW) && valueArg("confirm-r2-bucket") !== settings.bucket) {
    fail("Подтверждение R2-бакета не совпадает с R2_BUCKET_NAME.");
  }
  return settings;
}

function r2Client(settings) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${settings.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function storageLocation(publicUrl, bucket) {
  let url;
  try {
    url = new URL(publicUrl);
  } catch {
    return null;
  }
  if (url.origin !== new URL(SUPABASE_URL).origin) return null;
  const prefix = `/storage/v1/object/public/${bucket}/`;
  if (!url.pathname.startsWith(prefix)) return null;
  let objectPath;
  try { objectPath = decodeURIComponent(url.pathname.slice(prefix.length)); } catch { return null; }
  if (url.username || url.password || url.search || url.hash || /[\\\u0000-\u001f\u007f]/.test(objectPath)) return null;
  if (!objectPath || objectPath.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return { bucket, objectPath, key: `${bucket}/${objectPath}` };
}

function targetUrl(settings, key) {
  return `${settings.publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function addReference(objects, ref) {
  if (!ref.oldUrl) return;
  let location = storageLocation(ref.oldUrl, ref.bucket);
  if (ROLLBACK_NEW) {
    const base = new URL(required("NEXT_PUBLIC_MEDIA_BASE_URL"));
    let source;
    try { source = new URL(ref.oldUrl); } catch { return; }
    const prefix = `${base.pathname.replace(/\/$/, "")}/${ref.bucket}/`;
    if (source.origin !== base.origin || source.username || source.password || source.search || source.hash || !source.pathname.startsWith(prefix)) return;
    location = storageLocation(`${SUPABASE_URL}/storage/v1/object/public/${ref.bucket}/${source.pathname.slice(prefix.length)}`, ref.bucket);
  }
  if (!location) return;
  const existing = objects.get(location.key) ?? {
    ...location,
    sourceUrl: ref.oldUrl,
    references: [],
  };
  existing.references.push(ref);
  objects.set(location.key, existing);
}

async function readAllRows(table, columns, orderColumn) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from(table).select(columns).order(orderColumn).range(offset, offset + 499);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) return { data: rows };
  }
}

async function loadCandidates() {
  const [imagesResult, categoriesResult, subcategoriesResult, brandsResult] = await Promise.all([
    readAllRows("product_images", "id, url, thumbnail_url, gallery_url", "id"),
    readAllRows("categories", "slug, image", "slug"),
    readAllRows("subcategories", "id, image", "id"),
    readAllRows("brands", "slug, logo", "slug"),
  ]);
  for (const result of [imagesResult, categoriesResult, subcategoriesResult, brandsResult]) {
    if (result.error) throw result.error;
  }

  const objects = new Map();
  for (const image of imagesResult.data ?? []) {
    for (const field of ["url", "thumbnail_url", "gallery_url"]) {
      addReference(objects, {
        bucket: "product-images",
        table: "product_images",
        idColumn: "id",
        idValue: image.id,
        field,
        oldUrl: image[field],
      });
    }
  }
  for (const category of categoriesResult.data ?? []) {
    addReference(objects, {
      bucket: "category-images",
      table: "categories",
      idColumn: "slug",
      idValue: category.slug,
      field: "image",
      oldUrl: category.image,
    });
  }
  for (const subcategory of subcategoriesResult.data ?? []) {
    addReference(objects, {
      bucket: "category-images",
      table: "subcategories",
      idColumn: "id",
      idValue: subcategory.id,
      field: "image",
      oldUrl: subcategory.image,
    });
  }
  for (const brand of brandsResult.data ?? []) {
    addReference(objects, {
      bucket: "brand-logos",
      table: "brands",
      idColumn: "slug",
      idValue: brand.slug,
      field: "logo",
      oldUrl: brand.logo,
    });
  }

  const heroPaths = [
    "hero/2026-08-27-startup/hero-startup-desktop.mp4",
    "hero/2026-08-27-startup/hero-startup-mobile.mp4",
    "hero/2026-08-18-2k/hero-background-desktop.mp4",
    "hero/2026-08-18-2k/hero-background-mobile.mp4",
  ];
  for (const objectPath of ROLLBACK_NEW ? [] : heroPaths) {
    const sourceUrl = `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/site-media/${objectPath}`;
    const location = storageLocation(sourceUrl, "site-media");
    objects.set(location.key, { ...location, sourceUrl, references: [] });
  }

  return [...objects.values()];
}

function selectScope(objects) {
  if (SCOPE === "video") return objects.filter((object) => object.bucket === "site-media");
  if (SCOPE === "all") return objects;

  const selected = [];
  const products = objects.filter((object) => object.bucket === "product-images");
  const formatExamples = [/\.png$/i, /\.jpe?g$/i, /\.webp$/i].flatMap((pattern) => {
    const object = products.find((item) => pattern.test(item.objectPath) && item.references.some((ref) => ref.field === "url"));
    return object?.references.filter((ref) => ref.field === "url").map((ref) => ref.idValue) ?? [];
  });
  const productIds = [...new Set([...formatExamples, ...products.flatMap((object) => object.references.map((ref) => ref.idValue))])].slice(0, 10);
  selected.push(...products.filter((object) => object.references.some((ref) => productIds.includes(ref.idValue))));
  for (const table of ["categories", "subcategories", "brands"]) {
    const candidate = objects.find((object) => object.references.some((ref) => ref.table === table));
    if (candidate) selected.push(candidate);
  }
  return [...new Map(selected.map((object) => [object.key, object])).values()];
}

async function appendJournal(event) {
  await mkdir(path.dirname(JOURNAL_PATH), { recursive: true });
  await appendFile(JOURNAL_PATH, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, "utf8");
}

async function existingObjectMatches(client, settings, object, bytes, digest) {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: settings.bucket, Key: object.key }));
    if (head.ContentLength !== bytes.byteLength) {
      throw new Error(`В R2 уже есть файл другого размера: ${object.key}`);
    }
    if (head.Metadata?.sha256 === digest) return true;
    const downloaded = await client.send(new GetObjectCommand({ Bucket: settings.bucket, Key: object.key }));
    const existingBytes = Buffer.from(await downloaded.Body.transformToByteArray());
    if (sha256(existingBytes) !== digest) throw new Error(`В R2 уже есть файл другого содержания: ${object.key}`);
    return true;
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey") return false;
    throw error;
  }
}

async function copyObject(client, settings, object) {
  const response = await fetch(object.sourceUrl, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Источник ${response.status}: ${object.sourceUrl}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = sha256(bytes);
  const backupDirectory = path.join(path.dirname(JOURNAL_PATH), "objects");
  await mkdir(backupDirectory, { recursive: true });
  const backupPath = path.join(backupDirectory, digest);
  await writeFile(backupPath, bytes, { flag: "wx" }).catch((error) => { if (error.code !== "EEXIST") throw error; });
  if (sha256(await readFile(backupPath)) !== digest) throw new Error(`Повреждена локальная копия ${object.key}`);
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const existed = await existingObjectMatches(client, settings, object, bytes, digest);

  if (!existed) {
    await client.send(new PutObjectCommand({
      Bucket: settings.bucket,
      Key: object.key,
      Body: bytes,
      ContentLength: bytes.byteLength,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
      Metadata: { sha256: digest, source: "supabase" },
      IfNoneMatch: "*",
    }));
    if (!(await existingObjectMatches(client, settings, object, bytes, digest))) throw new Error(`Копия R2 отсутствует: ${object.key}`);
  }

  const publicHead = await fetch(targetUrl(settings, object.key), { method: "HEAD", signal: AbortSignal.timeout(30000) });
  if (!publicHead.ok || Number(publicHead.headers.get("content-length")) !== bytes.byteLength) {
    throw new Error(`Публичная копия не подтверждена: ${object.key}, HTTP ${publicHead.status}`);
  }
  await appendJournal({
    event: "copy_success",
    key: object.key,
    sourceUrl: object.sourceUrl,
    targetUrl: targetUrl(settings, object.key),
    byteSize: bytes.byteLength,
    contentType,
    sha256: digest,
    reused: existed,
    backupPath,
  });
  return { byteSize: bytes.byteLength, contentType, digest };
}

async function updateReference(settings, ref) {
  const location = storageLocation(ref.oldUrl, ref.bucket);
  const newUrl = targetUrl(settings, location.key);
  // Write-ahead journal covers a process failure after DB commit but before
  // the success event. Rollback still uses CAS to protect subsequent edits.
  await appendJournal({ event: "db_update_intent", ref, newUrl });
  const { data, error } = await supabase
    .from(ref.table)
    .update({ [ref.field]: newUrl })
    .eq(ref.idColumn, ref.idValue)
    .eq(ref.field, ref.oldUrl)
    .select(ref.idColumn);
  if (error) throw error;
  if (!data || data.length !== 1) {
    throw new Error(`CAS не обновил ${ref.table}.${ref.field} для ${ref.idValue}: значение изменилось параллельно.`);
  }
  await appendJournal({ event: "db_update", status: "success", ref, newUrl });
}

async function runPool(items, worker) {
  let cursor = 0;
  const errors = [];
  await Promise.all(Array.from({ length: Math.min(2, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        await worker(items[index], index);
      } catch (error) {
        errors.push({ item: items[index].key, message: error instanceof Error ? error.message : String(error) });
        await appendJournal({ event: "error", key: items[index].key, message: errors.at(-1).message });
      }
    }
  }));
  return errors;
}

async function rollback() {
  const raw = await readFile(JOURNAL_PATH, "utf8");
  const updates = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    .filter((entry) => entry.event === "db_update_intent")
    .reverse();
  let restored = 0;
  for (const entry of updates) {
    const { ref, newUrl } = entry;
    const allowed = { product_images: { id: "id", fields: ["url", "thumbnail_url", "gallery_url"] }, categories: { id: "slug", fields: ["image"] }, subcategories: { id: "id", fields: ["image"] }, brands: { id: "slug", fields: ["logo"] } };
    const rule = allowed[ref.table];
    if (!rule || ref.idColumn !== rule.id || !rule.fields.includes(ref.field) || !storageLocation(ref.oldUrl, ref.bucket)) throw new Error("Недопустимая запись журнала отката.");
    const source = await fetch(ref.oldUrl, { method: "HEAD", signal: AbortSignal.timeout(30000) });
    if (!source.ok) throw new Error(`Источник отката недоступен: HTTP ${source.status}`);
    const { data, error } = await supabase
      .from(ref.table)
      .update({ [ref.field]: ref.oldUrl })
      .eq(ref.idColumn, ref.idValue)
      .eq(ref.field, newUrl)
      .select(ref.idColumn);
    if (error) throw error;
    if (!data || data.length !== 1) {
      await appendJournal({ event: "rollback_skip", ref, newUrl, reason: "current-value-changed" });
      continue;
    }
    restored += 1;
    await appendJournal({ event: "rollback_success", ref, newUrl });
  }
  console.log(JSON.stringify({ mode: "rollback", restored, skipped: updates.length - restored, journal: JOURNAL_PATH }, null, 2));
}

async function main() {
  if (ROLLBACK) return rollback();
  if (ROLLBACK_NEW) return rollbackNewUploads();

  const allObjects = await loadCandidates();
  const objects = selectScope(allObjects);
  const counts = Object.fromEntries(
    ["product-images", "category-images", "brand-logos", "site-media"].map((bucket) => [
      bucket,
      objects.filter((object) => object.bucket === bucket).length,
    ]),
  );

  await appendJournal({
    event: "inventory",
    mode: APPLY ? "apply" : "dry-run",
    scope: SCOPE,
    projectRef: PROJECT_REF,
    objectCount: objects.length,
    referenceCount: objects.reduce((sum, object) => sum + object.references.length, 0),
    counts,
    objects,
  });

  if (!APPLY) {
    console.log(JSON.stringify({ mode: "dry-run", scope: SCOPE, counts, objectCount: objects.length, journal: JOURNAL_PATH }, null, 2));
    return;
  }

  const settings = r2Settings();
  const client = r2Client(settings);
  let copied = 0;
  let updated = 0;
  const errors = await runPool(objects, async (object) => {
    await copyObject(client, settings, object);
    copied += 1;
    if (!COPY_ONLY) {
      for (const ref of object.references) {
        await updateReference(settings, ref);
        updated += 1;
      }
    }
  });

  console.log(JSON.stringify({
    mode: COPY_ONLY ? "copy-only" : "apply",
    scope: SCOPE,
    copied,
    updated,
    failed: errors.length,
    errors,
    journal: JOURNAL_PATH,
  }, null, 2));
  if (errors.length > 0) process.exitCode = 1;
}

async function rollbackNewUploads() {
  if (valueArg("confirm-r2-bucket") !== required("R2_BUCKET_NAME")) throw new Error("Подтверждение R2-бакета не совпадает.");
  const bucket = required("MEDIA_STORAGE_JOURNAL_BUCKET");
  const journal = await supabase.storage.getBucket(bucket);
  if (journal.error) throw journal.error;
  if (!journal.data || journal.data.public) throw new Error("Квитанции должны храниться в закрытом bucket.");
  const objects = await loadCandidates();
  let restored = 0;
  let migrated = 0;
  const errors = await runPool(objects, async (object) => {
    // Rollback must also work while R2 itself is unavailable.
    const listed = await supabase.storage.from(bucket).list(object.key, { limit: 2 });
    if (listed.error) throw listed.error;
    if (!listed.data?.length) {
      migrated++;
      await appendJournal({ event: "new_media_restore_skip", key: object.key, reason: "no-receipt-use-original-migration-journal-or-investigate" });
      return;
    }
    if (listed.data.length !== 1) throw new Error(`Неоднозначная квитанция: ${object.key}`);
    const digest = listed.data[0].name.replace(/\.json$/, "");
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`Нет SHA-256: ${object.key}`);
    const downloaded = await supabase.storage.from(bucket).download(`${object.key}/${digest}.json`);
    if (downloaded.error) throw downloaded.error;
    const receipt = JSON.parse(await downloaded.data.text());
    const backupLocation = storageLocation(receipt.backupUrl, object.bucket);
    if (receipt.r2Url !== object.sourceUrl || receipt.key !== object.key || receipt.sha256 !== digest ||
        !Number.isSafeInteger(receipt.size) || receipt.size < 0 || backupLocation?.key !== object.key) throw new Error(`Недопустимая квитанция: ${object.key}`);
    const response = await fetch(receipt.backupUrl, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Резервная копия недоступна: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== receipt.size || sha256(bytes) !== digest) throw new Error(`Повреждена резервная копия: ${object.key}`);
    for (const ref of object.references) {
      await appendJournal({ event: "new_media_restore_intent", ref, backupUrl: receipt.backupUrl, sha256: digest });
      const { data, error } = await supabase.from(ref.table).update({ [ref.field]: receipt.backupUrl })
        .eq(ref.idColumn, ref.idValue).eq(ref.field, ref.oldUrl).select(ref.idColumn);
      if (error) throw error;
      if (data?.length !== 1) throw new Error(`CAS: ссылка изменена параллельно ${ref.table}/${ref.idValue}`);
      await appendJournal({ event: "new_media_restore_success", ref, backupUrl: receipt.backupUrl });
      restored++;
    }
  });
  console.log(JSON.stringify({ mode: "rollback-new", restored, skippedWithoutReceipt: migrated, errors, journal: JOURNAL_PATH }, null, 2));
  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
