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

/** Карточки каталога и admin-превью. */
export const THUMBNAIL_VARIANT = { name: "thumbnail", maxSide: 640, quality: 72 };
/** Галерея товара, zoom, OpenGraph, sitemap. */
export const GALLERY_VARIANT = { name: "gallery", maxSide: 1600, quality: 82 };

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
 * Неизменяемый путь варианта. `v1` — версия профиля обработки: если
 * когда-нибудь поменяются размеры или качество, новые файлы лягут в `v2`, а
 * уже отданные браузерам URL останутся валидными (они закешированы на год,
 * cacheControl=31536000, и перезаписывать их под тем же именем нельзя).
 */
export function buildVariantPath(productSlug, imageId, variantName, hash) {
  return `${productSlug}/${imageId}/variants/v1/${variantName}-${hash}.webp`;
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

  return { width, height };
}

async function encodeVariant(masterBuffer, variant) {
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
 * Считает оба варианта из master и возвращает их вместе с готовыми путями.
 * Загрузку в Storage и запись в БД выполняет вызывающая сторона — так один
 * и тот же генератор обслуживает и Server Action (service-role клиент), и
 * backfill-скрипт (свой клиент и своя политика повторов).
 *
 * Не мутирует и не удаляет master: оригинал хранится постоянно и остаётся
 * целью отката.
 */
export async function generateProductImageVariants(masterBuffer, { productSlug, imageId }) {
  if (!productSlug) throw new ProductImageVariantError("Не передан slug товара для пути варианта.");
  if (!imageId) throw new ProductImageVariantError("Не передан id изображения для пути варианта.");

  const source = await readSourceMetadata(masterBuffer);

  // Ровно два одновременных sharp-прохода — столько и есть вариантов.
  // Больше параллелизма здесь взять неоткуда, а меньше (последовательно)
  // удвоило бы время на каждое фото.
  const encoded = await Promise.all(PRODUCT_IMAGE_VARIANTS.map((variant) => encodeVariant(masterBuffer, variant)));

  const variants = {};
  for (const [index, variant] of PRODUCT_IMAGE_VARIANTS.entries()) {
    const body = encoded[index];
    const hash = contentHash(body);
    variants[variant.name] = {
      name: variant.name,
      body,
      hash,
      path: buildVariantPath(productSlug, imageId, variant.name, hash),
      bytes: body.byteLength,
    };
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
