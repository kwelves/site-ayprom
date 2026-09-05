/**
 * Чистая логика backfill-скрипта вариантов: разбор аргументов, определение
 * проекта и безопасный разбор публичного URL Storage.
 *
 * Вынесена из scripts/backfill-product-image-variants.mjs, чтобы эти функции
 * можно было покрыть unit-тестами: сам скрипт запускает main() на импорте и
 * из теста не импортируется. Как и остальные *.core.mjs в этой папке — на
 * чистом JS, чтобы голый `node scripts/...mjs` мог их подтянуть без
 * TypeScript-loader'а.
 */

export const STORAGE_BUCKET = "product-images";
export const DEFAULT_BATCH_SIZE = 25;
export const DEFAULT_CONCURRENCY = 2;
export const MAX_NETWORK_ATTEMPTS = 3;

export function parseBackfillArgs(argv) {
  const flags = new Map();
  for (const arg of argv.slice(2)) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) continue;
    flags.set(match[1], match[2] ?? "true");
  }

  const number = (name, fallback) => {
    const raw = flags.get(name);
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`--${name} должен быть положительным целым числом.`);
    }
    return parsed;
  };

  return {
    apply: flags.get("apply") === "true",
    // Два разных режима выборки. Без флага — «дозаполнить пропуски»: строки,
    // у которых вариантов ещё нет. С флагом — «переснять под текущий профиль»:
    // строки, чей thumbnail лежит на пути прежней версии профиля. Первый
    // режим уже отработавшие строки не видит, поэтому сам по себе обновить
    // существующие превью не может.
    regenerate: flags.get("regenerate") === "true",
    confirmProjectRef: flags.get("confirm-project-ref") ?? null,
    limit: flags.has("limit") ? number("limit") : null,
    batchSize: number("batch", DEFAULT_BATCH_SIZE),
    concurrency: number("concurrency", DEFAULT_CONCURRENCY),
    jsonlPath: flags.get("jsonl") ?? null,
  };
}

/** Фрагмент пути, по которому узнаётся вариант актуальной версии профиля. */
export function variantProfileMarker(variant) {
  return `/variants/${variant.profileVersion}/${variant.name}-`;
}

/** Лежит ли ссылка на актуальной версии профиля обработки. */
export function isCurrentProfileUrl(url, variant) {
  return typeof url === "string" && url.includes(variantProfileMarker(variant));
}

/** Ref проекта из URL вида https://<ref>.supabase.co. */
export function projectRefFromUrl(supabaseUrl) {
  try {
    const host = new URL(supabaseUrl).hostname;
    return host.endsWith(".supabase.co") ? host.slice(0, -".supabase.co".length) : host;
  } catch {
    return null;
  }
}

/**
 * Путь объекта внутри бакета из его публичного URL — с проверкой, что URL
 * указывает именно на наш Supabase и наш бакет.
 *
 * Проверка origin здесь не формальность: backfill скачивает содержимое по
 * этой ссылке, а значение приходит из строки БД. Без сверки происхождения
 * подменённый url заставил бы скрипт тянуть произвольный сетевой ресурс и
 * записывать его как «вариант» товарного фото.
 */
export function storagePathFromPublicUrl(publicUrl, supabaseUrl) {
  let parsed;
  let expectedOrigin;
  try {
    parsed = new URL(publicUrl);
    expectedOrigin = new URL(supabaseUrl).origin;
  } catch {
    return null;
  }
  if (parsed.origin !== expectedOrigin) return null;

  const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
  if (!parsed.pathname.startsWith(marker)) return null;

  const path = decodeURIComponent(parsed.pathname.slice(marker.length));
  // Относительный путь без выходов вверх: `..` внутри пути позволил бы
  // адресовать объект вне префикса товара.
  if (!path || path.startsWith("/") || path.split("/").includes("..")) return null;
  return path;
}

/** Считается ли ошибка загрузки «объект уже существует». Имя файла варианта
 * — хеш его содержимого, поэтому такой конфликт означает «уже сделано», а не
 * расхождение: перезаписывать нечего. */
export function isAlreadyExistsError(error) {
  if (!error) return false;
  const status = String(error.statusCode ?? error.status ?? "");
  return status === "409" || /already exists|duplicate/i.test(error.message ?? "");
}
