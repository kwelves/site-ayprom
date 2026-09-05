/**
 * Buffer-in/buffers-out генератор WebP-вариантов товарного фото — общий для
 * трёх путей: создание товара, редактирование (загрузка отдельного фото) и
 * backfill существующих строк. Все три обязаны получать байт-в-байт
 * одинаковый результат, поэтому реализация ровно одна.
 *
 * Намеренно на чистом JS, а не TypeScript, по той же причине, что и
 * enhance-product-photo.core.mjs: backfill-скрипт запускается голым
 * `node scripts/...mjs` без TypeScript-loader'а, и `.ts` оттуда не
 * импортировался бы. Бандлер Next импортирует этот же файл из серверного
 * кода без проблем.
 *
 * Оба варианта считаются НЕЗАВИСИМО из одного master-буфера, а не
 * thumbnail из gallery: пересжатие уже сжатого WebP накапливает потери,
 * а thumbnail из 1600px-промежутка заметно хуже, чем из оригинала.
 */

import { createHash } from "node:crypto";
import sharp from "sharp";

/**
 * Карточки каталога и admin-превью.
 *
 * v2 отличается от прежнего thumbnail-профиля: это всегда холст 4:3, а не
 * просто картинка с длинной стороной 640px. Если у исходника есть однородные
 * внешние поля, деталь сначала аккуратно отделяется от них и центрируется на
 * холсте. Единый видимый отступ задаёт сама ProductCard, поэтому генератор не
 * добавляет второй слой воздуха и не обрезает товар через object-cover.
 */
export const THUMBNAIL_VARIANT = {
  name: "thumbnail",
  profileVersion: "v2",
  width: 640,
  height: 480,
  trimThreshold: 12,
  trimMarginRatio: 0.01,
  quality: 72,
};
/** Галерея товара, zoom, OpenGraph, sitemap. */
export const GALLERY_VARIANT = { name: "gallery", profileVersion: "v1", maxSide: 1600, quality: 82 };

export const PRODUCT_IMAGE_VARIANTS = [THUMBNAIL_VARIANT, GALLERY_VARIANT];

/** Та же граница, что и в image-validation.ts: защита от «пиксельной бомбы»
 * — маленького файла, разворачивающегося в гигантский растр. Проверяется и
 * здесь, потому что backfill получает байты из Storage, минуя валидацию
 * загрузки. */
export const MAX_SOURCE_PIXELS = 40_000_000;

/** Верхняя граница на один sharp-проход. Пайплайн работает внутри Server
 * Action / serverless-функции с общим лимитом выполнения, поэтому зависший
 * декодер обязан падать сам, а не съедать весь бюджет запроса. */
export const VARIANT_PROCESSING_TIMEOUT_SECONDS = 25;

/** Длина hex-хвоста в имени файла варианта. Хеш берётся от содержимого
 * готового варианта: путь становится самоадресуемым, а повторный прогон
 * backfill по тому же master даёт то же имя и не плодит мусор. */
const VARIANT_HASH_LENGTH = 16;

export class ProductImageVariantError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = "ProductImageVariantError";
  }
}

function contentHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, VARIANT_HASH_LENGTH);
}

/**
 * Неизменяемый путь варианта. Версия принадлежит конкретному профилю: у
 * thumbnail уже v2, потому что его геометрия изменилась, а gallery остаётся
 * на v1 с прежними байтами. Уже отданные браузерам URL остаются валидными
 * (они закешированы на год, cacheControl=31536000), и мы не перезаписываем
 * содержимое под старым путём.
 */
export function buildVariantPath(productSlug, imageId, variantName, hash) {
  const variant = PRODUCT_IMAGE_VARIANTS.find((candidate) => candidate.name === variantName);
  if (!variant) throw new ProductImageVariantError(`Неизвестный вариант изображения: ${variantName}.`);
  return `${productSlug}/${imageId}/variants/${variant.profileVersion}/${variantName}-${hash}.webp`;
}

async function readSourceMetadata(masterBuffer) {
  let metadata;
  try {
    metadata = await sharp(masterBuffer).metadata();
  } catch (error) {
    throw new ProductImageVariantError("Не удалось прочитать изображение: файл повреждён или формат не поддерживается.", {
      cause: error,
    });
  }

  const { width, height } = metadata;
  if (!width || !height) {
    throw new ProductImageVariantError("Не удалось определить размеры изображения.");
  }
  if (width * height > MAX_SOURCE_PIXELS) {
    throw new ProductImageVariantError(
      `Изображение превышает допустимые ${MAX_SOURCE_PIXELS / 1_000_000} Мп (${width}×${height}).`,
    );
  }

  // Анимацию отклоняем явно, а не сплющиваем в первый кадр: молчаливая
  // потеря анимации выглядела бы как «загрузилось, но не так», и админ
  // узнал бы об этом только увидев результат на сайте.
  if ((metadata.pages ?? 1) > 1) {
    throw new ProductImageVariantError(
      "Анимированные изображения не поддерживаются — загрузите один кадр.",
    );
  }

  return { width, height, hasAlpha: metadata.hasAlpha === true };
}

async function encodeGalleryVariant(masterBuffer, variant) {
  try {
    return await sharp(masterBuffer, { animated: false })
      .timeout({ seconds: VARIANT_PROCESSING_TIMEOUT_SECONDS })
      // EXIF-ориентация применяется к пикселям здесь, до resize: иначе
      // портретное фото с камеры легло бы в квадрат бокса «на боку».
      .rotate()
      .resize({
        width: variant.maxSide,
        height: variant.maxSide,
        fit: "inside",
        // Апскейл мелкого исходника только раздул бы файл, не добавив
        // деталей: вариант меньше своей границы — нормальный результат.
        withoutEnlargement: true,
      })
      .webp({ quality: variant.quality, effort: 4, smartSubsample: true })
      .toBuffer();
  } catch (error) {
    throw new ProductImageVariantError(`Не удалось создать вариант «${variant.name}».`, { cause: error });
  }
}

/**
 * Возвращает ориентированный растр и, когда это безопасно, убирает только
 * однородную внешнюю рамку. Защитная проверка площади не позволяет trim
 * превратить почти однотонное изображение в случайный крошечный фрагмент.
 */
async function prepareThumbnailContent(masterBuffer, variant) {
  const oriented = await sharp(masterBuffer, { animated: false })
    .timeout({ seconds: VARIANT_PROCESSING_TIMEOUT_SECONDS })
    .rotate()
    .toBuffer({ resolveWithObject: true });

  const margin = Math.max(1, Math.round(Math.min(oriented.info.width, oriented.info.height) * variant.trimMarginRatio));
  const trimmed = await sharp(oriented.data)
    .timeout({ seconds: VARIANT_PROCESSING_TIMEOUT_SECONDS })
    .trim({ threshold: variant.trimThreshold, margin })
    .toBuffer({ resolveWithObject: true });

  const removedWidthRatio = 1 - trimmed.info.width / oriented.info.width;
  const removedHeightRatio = 1 - trimmed.info.height / oriented.info.height;
  const retainedAreaRatio =
    (trimmed.info.width * trimmed.info.height) / (oriented.info.width * oriented.info.height);
  const trimIsMeaningful = removedWidthRatio >= 0.02 || removedHeightRatio >= 0.02;
  const trimLooksSafe = trimmed.info.width >= 8 && trimmed.info.height >= 8 && retainedAreaRatio >= 0.01;

  return trimIsMeaningful && trimLooksSafe ? { body: trimmed.data, trimmed: true } : { body: oriented.data, trimmed: false };
}

async function encodeThumbnailVariant(masterBuffer, variant, source) {
  try {
    const content = await prepareThumbnailContent(masterBuffer, variant);
    const resized = await sharp(content.body)
      .timeout({ seconds: VARIANT_PROCESSING_TIMEOUT_SECONDS })
      .resize({
        width: variant.width,
        height: variant.height,
        fit: "inside",
        // У thumbnail фиксированный экранный размер. Небольшой исходник всё
        // равно увеличивался бы браузером, поэтому делаем это один раз здесь,
        // контролируемо, и сохраняем одинаковый холст для всех карточек.
        withoutEnlargement: false,
      })
      .toBuffer({ resolveWithObject: true });

    const background = source.hasAlpha
      ? { r: 0, g: 0, b: 0, alpha: 0 }
      : { r: 255, g: 255, b: 255 };
    const channels = source.hasAlpha ? 4 : 3;
    const left = Math.round((variant.width - resized.info.width) / 2);
    const top = Math.round((variant.height - resized.info.height) / 2);

    return await sharp({
      create: { width: variant.width, height: variant.height, channels, background },
    })
      .composite([{ input: resized.data, left, top }])
      .webp({ quality: variant.quality, effort: 4, smartSubsample: true })
      .toBuffer();
  } catch (error) {
    throw new ProductImageVariantError(`Не удалось создать вариант «${variant.name}».`, { cause: error });
  }
}

/** Готовое описание варианта: имя файла — хеш содержимого, поэтому путь
 * однозначно определяется байтами и никогда не перезаписывается. */
function describeVariant(variant, body, productSlug, imageId) {
  const hash = contentHash(body);
  return {
    name: variant.name,
    body,
    hash,
    path: buildVariantPath(productSlug, imageId, variant.name, hash),
    bytes: body.byteLength,
  };
}

function assertVariantTarget({ productSlug, imageId }) {
  if (!productSlug) throw new ProductImageVariantError("Не передан slug товара для пути варианта.");
  if (!imageId) throw new ProductImageVariantError("Не передан id изображения для пути варианта.");
}

/**
 * Считает только thumbnail — для перегенерации уже загруженных фотографий
 * под новый профиль карточки. Gallery при этом не трогается: её параметры не
 * менялись, пересчёт дал бы те же байты и тот же путь, а лишний проход по
 * стороне 1600px стоит заметно дороже самого thumbnail.
 */
export async function generateProductThumbnailVariant(masterBuffer, { productSlug, imageId }) {
  assertVariantTarget({ productSlug, imageId });

  const source = await readSourceMetadata(masterBuffer);
  const body = await encodeThumbnailVariant(masterBuffer, THUMBNAIL_VARIANT, source);

  return { source, thumbnail: describeVariant(THUMBNAIL_VARIANT, body, productSlug, imageId) };
}

/**
 * Считает оба варианта из master и возвращает их вместе с готовыми путями.
 * Загрузку в Storage и запись в БД выполняет вызывающая сторона — так один
 * и тот же генератор обслуживает и Server Action (service-role клиент), и
 * backfill-скрипт (свой клиент и своя политика повторов).
 *
 * Не мутирует и не удаляет master: оригинал хранится постоянно и остаётся
 * целью отката.
 */
export async function generateProductImageVariants(masterBuffer, { productSlug, imageId }) {
  assertVariantTarget({ productSlug, imageId });

  const source = await readSourceMetadata(masterBuffer);

  // Оба варианта по-прежнему считаются независимо и одновременно из master.
  // Thumbnail получает собственный нормализующий профиль, gallery сохраняет
  // прежнюю геометрию и не наследует пересжатие карточки.
  const encoded = await Promise.all([
    encodeThumbnailVariant(masterBuffer, THUMBNAIL_VARIANT, source),
    encodeGalleryVariant(masterBuffer, GALLERY_VARIANT),
  ]);

  const variants = {};
  for (const [index, variant] of PRODUCT_IMAGE_VARIANTS.entries()) {
    variants[variant.name] = describeVariant(variant, encoded[index], productSlug, imageId);
  }

  return { source, thumbnail: variants.thumbnail, gallery: variants.gallery };
}

/** Опции загрузки варианта в Supabase Storage. Вынесены сюда, чтобы Server
 * Action и backfill не разошлись в cache-политике: файлы неизменяемы по
 * построению (хеш в имени), поэтому кешируются на год и никогда не
 * перезаписываются (upsert: false). */
export const VARIANT_UPLOAD_OPTIONS = {
  contentType: "image/webp",
  cacheControl: "31536000",
  upsert: false,
};
