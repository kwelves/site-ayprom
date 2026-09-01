/**
 * Досчитывает WebP-варианты (thumbnail 640/q72, gallery 1600/q82) для уже
 * загруженных товарных фотографий.
 *
 * Строки, у которых варианты уже заполнены, пропускаются, поэтому скрипт
 * безопасно перезапускать. Оригиналы (product_images.url) не удаляются и не
 * изменяются — это цель отката и гарантия того, что повторный прогон всегда
 * возможен.
 *
 * Обработка идёт той же функцией, что и загрузка новых фото через админку
 * (src/lib/admin/product-image-variants.core.mjs), поэтому backfill и
 * рантайм не могут разойтись в параметрах.
 *
 * По умолчанию — только dry-run. Для записи нужны ОБА флага:
 *   node scripts/backfill-product-image-variants.mjs \
 *     --apply --confirm-project-ref=<ref>
 *
 * Полезные флаги:
 *   --limit=N       обработать не более N строк (canary-прогон)
 *   --batch=N       размер страницы выборки (по умолчанию 25)
 *   --concurrency=N сколько фотографий обрабатывать параллельно (по умолчанию 2)
 *   --jsonl=PATH    писать построчный отчёт в файл
 *
 * Переменные окружения: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY.
 */

import { promises as fs } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  generateProductImageVariants,
  VARIANT_UPLOAD_OPTIONS,
} from "../src/lib/admin/product-image-variants.core.mjs";
import {
  isAlreadyExistsError,
  MAX_NETWORK_ATTEMPTS,
  parseBackfillArgs,
  projectRefFromUrl,
  STORAGE_BUCKET as BUCKET,
  storagePathFromPublicUrl,
} from "../src/lib/admin/product-image-backfill.core.mjs";

const RETRY_BASE_DELAY_MS = 400;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Повтор только для сетевых/транзиентных сбоев. Ошибки декодирования и
 * конфликты повторять бессмысленно — они детерминированы. */
async function withRetry(operation, label) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_NETWORK_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_NETWORK_ATTEMPTS) await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }
  throw new Error(`${label}: ${lastError?.message ?? "неизвестная ошибка"}`, { cause: lastError });
}

async function uploadVariant(supabase, variant) {
  const { error } = await supabase.storage.from(BUCKET).upload(variant.path, variant.body, VARIANT_UPLOAD_OPTIONS);
  if (!error) return "uploaded";
  if (isAlreadyExistsError(error)) return "exists";
  throw error;
}

async function processRow(row, context) {
  const { supabase, supabaseUrl, dryRun } = context;

  const masterPath = storagePathFromPublicUrl(row.url, supabaseUrl);
  if (!masterPath) {
    return { id: row.id, status: "skipped", reason: "url вне ожидаемого Supabase/bucket", bytesIn: 0, bytesOut: 0 };
  }

  const download = await withRetry(async () => {
    const result = await supabase.storage.from(BUCKET).download(masterPath);
    if (result.error) throw result.error;
    return result.data;
  }, `скачивание ${masterPath}`);

  const master = Buffer.from(await download.arrayBuffer());

  let variants;
  try {
    variants = await generateProductImageVariants(master, {
      productSlug: row.product_slug,
      imageId: row.id,
    });
  } catch (error) {
    // Сбой декодирования детерминирован: повтор не поможет, строка идёт в
    // отчёт как ошибка и остаётся без вариантов — сайт продолжает отдавать
    // оригинал через coalesce-fallback.
    return { id: row.id, status: "error", reason: error.message, bytesIn: master.byteLength, bytesOut: 0 };
  }

  const { thumbnail, gallery } = variants;
  const bytesOut = thumbnail.bytes + gallery.bytes;

  if (dryRun) {
    return {
      id: row.id,
      status: "would-write",
      bytesIn: master.byteLength,
      bytesOut,
      thumbnailPath: thumbnail.path,
      galleryPath: gallery.path,
    };
  }

  for (const variant of [thumbnail, gallery]) {
    await withRetry(() => uploadVariant(supabase, variant), `загрузка ${variant.path}`);
  }

  const publicUrl = (path) => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  // Условное обновление: заполняем только если master не изменился и
  // варианты всё ещё пусты. Если параллельно прошла админка (перезалила
  // фото или уже досчитала варианты) — строка не трогается, а конфликт
  // уходит в отчёт.
  const { data: updated, error: updateError } = await supabase
    .from("product_images")
    .update({ thumbnail_url: publicUrl(thumbnail.path), gallery_url: publicUrl(gallery.path) })
    .eq("id", row.id)
    .eq("url", row.url)
    .is("thumbnail_url", null)
    .is("gallery_url", null)
    .select("id");
  if (updateError) throw updateError;

  if (!updated || updated.length === 0) {
    return { id: row.id, status: "conflict", reason: "строка изменилась во время обработки", bytesIn: master.byteLength, bytesOut };
  }

  return { id: row.id, status: "done", bytesIn: master.byteLength, bytesOut, thumbnailPath: thumbnail.path, galleryPath: gallery.path };
}

/** Обрабатывает пачку с ограниченной параллельностью. */
async function processBatch(rows, context) {
  const results = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      try {
        results.push(await processRow(row, context));
      } catch (error) {
        results.push({ id: row.id, status: "error", reason: error.message, bytesIn: 0, bytesOut: 0 });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(context.concurrency, rows.length) }, worker));
  return results;
}

async function main() {
  const options = parseBackfillArgs(process.argv);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error("Нужны переменные окружения NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SECRET_KEY.");
  }

  const projectRef = projectRefFromUrl(supabaseUrl);
  const dryRun = !options.apply;

  // Запись требует явного подтверждения проекта: --apply в чужой консоли не
  // должен молча уйти в production, если в окружении оказался другой ref.
  if (!dryRun) {
    if (!options.confirmProjectRef) {
      throw new Error("Для записи нужен --confirm-project-ref=<ref>. Текущий проект: " + projectRef);
    }
    if (options.confirmProjectRef !== projectRef) {
      throw new Error(
        `--confirm-project-ref=${options.confirmProjectRef} не совпадает с проектом окружения (${projectRef}).`,
      );
    }
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(
    dryRun
      ? `DRY RUN (записи не будет). Проект: ${projectRef}`
      : `ЗАПИСЬ включена. Проект: ${projectRef}`,
  );

  const context = { supabase, supabaseUrl, dryRun, concurrency: options.concurrency };
  const totals = { total: 0, done: 0, wouldWrite: 0, skipped: 0, errors: 0, conflicts: 0, bytesIn: 0, bytesOut: 0 };
  const jsonlLines = [];
  // Keyset pagination вместо offset: в apply-режиме успешно обработанные
  // строки исчезают из выборки (thumbnail_url/gallery_url уже не NULL).
  // Если одновременно двигать offset, следующая ещё не обработанная пачка
  // сдвинется в начало и будет пропущена. Курсор по стабильному `id`
  // посещает каждую строку исходной выборки ровно один раз и одинаково
  // работает в dry-run и apply.
  let lastSeenId = null;

  for (;;) {
    const remaining = options.limit === null ? options.batchSize : options.limit - totals.total;
    if (remaining !== null && remaining <= 0) break;
    const pageSize = Math.min(options.batchSize, remaining ?? options.batchSize);

    let query = supabase
      .from("product_images")
      .select("id, url, products(slug)")
      .is("thumbnail_url", null)
      .is("gallery_url", null)
      .order("id")
      .limit(pageSize);
    if (lastSeenId) query = query.gt("id", lastSeenId);

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;

    const rows = data.map((row) => ({ id: row.id, url: row.url, product_slug: row.products?.slug }));
    const missingSlug = rows.filter((row) => !row.product_slug);
    for (const row of missingSlug) {
      jsonlLines.push(JSON.stringify({ id: row.id, status: "skipped", reason: "не найден slug товара" }));
      totals.skipped += 1;
    }

    const results = await processBatch(rows.filter((row) => row.product_slug), context);
    for (const result of results) {
      jsonlLines.push(JSON.stringify(result));
      totals.bytesIn += result.bytesIn ?? 0;
      totals.bytesOut += result.bytesOut ?? 0;
      if (result.status === "done") totals.done += 1;
      else if (result.status === "would-write") totals.wouldWrite += 1;
      else if (result.status === "skipped") totals.skipped += 1;
      else if (result.status === "conflict") totals.conflicts += 1;
      else totals.errors += 1;

      if (result.status === "error" || result.status === "conflict") {
        console.warn(`  [${result.status}] ${result.id}: ${result.reason}`);
      }
    }

    totals.total += rows.length;
    console.log(`Обработано строк: ${totals.total}`);

    lastSeenId = data.at(-1).id;
    if (data.length < pageSize) break;
  }

  if (options.jsonlPath) {
    await fs.writeFile(options.jsonlPath, jsonlLines.join("\n") + (jsonlLines.length ? "\n" : ""), "utf8");
    console.log(`Отчёт JSONL: ${options.jsonlPath}`);
  }

  const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2);
  console.log("\nИтог:");
  console.log(`  всего строк:      ${totals.total}`);
  console.log(dryRun ? `  готово бы:        ${totals.wouldWrite}` : `  готово:           ${totals.done}`);
  console.log(`  пропущено:        ${totals.skipped}`);
  console.log(`  конфликты:        ${totals.conflicts}`);
  console.log(`  ошибки:           ${totals.errors}`);
  console.log(`  входной объём:    ${mb(totals.bytesIn)} МБ`);
  console.log(`  выходной объём:   ${mb(totals.bytesOut)} МБ`);

  if (totals.errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
