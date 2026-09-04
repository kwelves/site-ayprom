import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  buildVariantPath,
  generateProductImageVariants,
  GALLERY_VARIANT,
  PRODUCT_IMAGE_VARIANTS,
  ProductImageVariantError,
  THUMBNAIL_VARIANT,
  VARIANT_UPLOAD_OPTIONS,
} from "@/lib/admin/product-image-variants.core.mjs";

const target = { productSlug: "gear-pump", imageId: "11111111-2222-3333-4444-555555555555" };

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 90, b: 180 } },
  })
    .jpeg()
    .toBuffer();
}

/** Шумная фикстура: у сплошной заливки нет высокочастотных деталей, поэтому
 * на ней любые два пути пересжатия дают одинаковый результат и ничего не
 * доказывают. Шум делает потери пересжатия наблюдаемыми. */
async function noisyJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 90, b: 180 },
      noise: { type: "gaussian", mean: 128, sigma: 60 },
    },
  })
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function jpegWithWhiteMargins(): Promise<Buffer> {
  const subject = await sharp({
    create: { width: 700, height: 525, channels: 3, background: { r: 35, g: 90, b: 180 } },
  })
    .png()
    .toBuffer();

  return sharp({
    create: { width: 1200, height: 900, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: subject, left: 250, top: 188 }])
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

async function nonWhiteBounds(buffer: Buffer) {
  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset] >= 240 && data[offset + 1] >= 240 && data[offset + 2] >= 240) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

describe("generateProductImageVariants", () => {
  it("создаёт фиксированный thumbnail 4:3 и оставляет gallery в исходных пропорциях", async () => {
    // 3000×2000 — крупнее обеих границ, соотношение 3:2.
    const { thumbnail, gallery } = await generateProductImageVariants(await jpeg(3000, 2000), target);

    const thumbMeta = await sharp(thumbnail.body).metadata();
    const galleryMeta = await sharp(gallery.body).metadata();

    expect(thumbMeta.format).toBe("webp");
    expect(galleryMeta.format).toBe("webp");
    expect(thumbMeta.width).toBe(THUMBNAIL_VARIANT.width);
    expect(thumbMeta.height).toBe(THUMBNAIL_VARIANT.height);
    expect(galleryMeta.width).toBe(GALLERY_VARIANT.maxSide);
    expect(galleryMeta.height).toBe(Math.round((GALLERY_VARIANT.maxSide * 2) / 3));
  });

  it("нормализует даже маленький thumbnail, но не увеличивает gallery", async () => {
    const { thumbnail, gallery } = await generateProductImageVariants(await jpeg(320, 240), target);

    expect(await sharp(thumbnail.body).metadata()).toMatchObject({ width: 640, height: 480 });
    expect((await sharp(gallery.body).metadata()).width).toBe(320);
  });

  it("убирает внешние белые поля и центрирует товар в единой безопасной области", async () => {
    const { thumbnail } = await generateProductImageVariants(await jpegWithWhiteMargins(), target);
    const bounds = await nonWhiteBounds(thumbnail.body);

    // Генератор убирает старые поля без второго внутреннего inset: единое
    // видимое расстояние по четырём сторонам добавляет ProductCard через p-4.
    expect(bounds.width).toBeGreaterThanOrEqual(610);
    expect(bounds.width).toBeLessThanOrEqual(630);
    expect(bounds.height).toBeGreaterThanOrEqual(450);
    expect(bounds.height).toBeLessThanOrEqual(470);
    expect(Math.abs(bounds.centerX - (THUMBNAIL_VARIANT.width - 1) / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds.centerY - (THUMBNAIL_VARIANT.height - 1) / 2)).toBeLessThanOrEqual(1);
  });

  it("не схлопывает почти однотонный кадр при агрессивном результате trim", async () => {
    const { thumbnail } = await generateProductImageVariants(await jpeg(1200, 900), target);
    const bounds = await nonWhiteBounds(thumbnail.body);

    expect(bounds.width).toBe(THUMBNAIL_VARIANT.width);
    expect(bounds.height).toBe(THUMBNAIL_VARIANT.height);
  });

  it("считает thumbnail из master, а не из gallery", async () => {
    // Прямая проверка независимости: thumbnail, посчитанный из master,
    // отличается от пересжатого gallery. Если бы генератор строил
    // thumbnail из gallery, буферы совпали бы.
    const master = await noisyJpeg(3000, 2000);
    const { thumbnail, gallery } = await generateProductImageVariants(master, target);

    const thumbFromGallery = await sharp(gallery.body)
      .resize({ width: THUMBNAIL_VARIANT.width, height: THUMBNAIL_VARIANT.height, fit: "inside" })
      .webp({ quality: THUMBNAIL_VARIANT.quality, effort: 4, smartSubsample: true })
      .toBuffer();

    expect(Buffer.compare(thumbnail.body, thumbFromGallery)).not.toBe(0);
  });

  it("применяет EXIF-ориентацию к пикселям", async () => {
    // orientation 6 = «повернуть на 90° по часовой»: 400×200 становится 200×400.
    const rotated = await sharp({
      create: { width: 400, height: 200, channels: 3, background: { r: 10, g: 10, b: 10 } },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const { gallery } = await generateProductImageVariants(rotated, target);
    const meta = await sharp(gallery.body).metadata();

    expect(meta.width).toBe(200);
    expect(meta.height).toBe(400);
  });

  it("вычищает EXIF/GPS из вариантов", async () => {
    const withExif = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .withMetadata({ exif: { IFD0: { Copyright: "AYPROM", Software: "test-suite" } } })
      .jpeg()
      .toBuffer();

    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const { thumbnail, gallery } = await generateProductImageVariants(withExif, target);
    expect((await sharp(thumbnail.body).metadata()).exif).toBeUndefined();
    expect((await sharp(gallery.body).metadata()).exif).toBeUndefined();
  });

  it("сохраняет прозрачность (WebP поддерживает альфу)", async () => {
    const transparent = await sharp({
      create: { width: 800, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();

    const { thumbnail, gallery } = await generateProductImageVariants(transparent, target);
    expect((await sharp(thumbnail.body).metadata()).hasAlpha).toBe(true);
    expect((await sharp(gallery.body).metadata()).hasAlpha).toBe(true);
  });

  it("отклоняет анимированные изображения явной ошибкой", async () => {
    // Минимальный валидный GIF89a 1×1 с двумя кадрами и NETSCAPE2.0-циклом.
    // Собран байтами, а не через sharp: эта сборка sharp не умеет писать
    // анимацию из create/raw (pageHeight на выходе даёт одну страницу),
    // поэтому фикстура из самого sharp молча проверяла бы не тот случай.
    const multiFrame = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAQABAAAC" +
        "AkQBACH5BAAKAAAALAAAAAABAAEAAAICRAEAOw==",
      "base64",
    );

    // Фикстура обязана быть многокадровой, иначе тест молча проверял бы не то.
    expect((await sharp(multiFrame, { animated: true }).metadata()).pages).toBe(2);

    await expect(generateProductImageVariants(multiFrame, target)).rejects.toThrow(ProductImageVariantError);
  });

  it("отклоняет повреждённый буфер, а не падает необработанным исключением", async () => {
    await expect(generateProductImageVariants(Buffer.from("not an image at all"), target)).rejects.toThrow(
      ProductImageVariantError,
    );
  });

  it("требует productSlug и imageId для построения пути", async () => {
    const master = await jpeg(400, 400);
    await expect(generateProductImageVariants(master, { productSlug: "", imageId: "x" })).rejects.toThrow(
      ProductImageVariantError,
    );
    await expect(generateProductImageVariants(master, { productSlug: "x", imageId: "" })).rejects.toThrow(
      ProductImageVariantError,
    );
  });

  it("кладёт варианты по неизменяемым путям с хешем содержимого", async () => {
    const { thumbnail, gallery } = await generateProductImageVariants(await jpeg(1000, 1000), target);

    expect(thumbnail.path).toBe(
      buildVariantPath(target.productSlug, target.imageId, "thumbnail", thumbnail.hash),
    );
    expect(gallery.path).toBe(buildVariantPath(target.productSlug, target.imageId, "gallery", gallery.hash));
    expect(thumbnail.path).toMatch(/^gear-pump\/[0-9a-f-]+\/variants\/v2\/thumbnail-[0-9a-f]{16}\.webp$/);
    expect(gallery.path).toMatch(/^gear-pump\/[0-9a-f-]+\/variants\/v1\/gallery-[0-9a-f]{16}\.webp$/);
    expect(thumbnail.path).not.toBe(gallery.path);
  });

  it("детерминирован: тот же master даёт те же хеши и пути", async () => {
    const master = await jpeg(1200, 900);
    const first = await generateProductImageVariants(master, target);
    const second = await generateProductImageVariants(master, target);

    expect(second.thumbnail.hash).toBe(first.thumbnail.hash);
    expect(second.gallery.path).toBe(first.gallery.path);
  });

  it("объявляет неизменяемую cache-политику для загрузки", () => {
    expect(VARIANT_UPLOAD_OPTIONS).toEqual({
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: false,
    });
  });

  it("описывает ровно два варианта с параметрами из плана", () => {
    expect(PRODUCT_IMAGE_VARIANTS).toHaveLength(2);
    expect(THUMBNAIL_VARIANT).toMatchObject({
      profileVersion: "v2",
      width: 640,
      height: 480,
      quality: 72,
    });
    expect(GALLERY_VARIANT).toMatchObject({ profileVersion: "v1", maxSide: 1600, quality: 82 });
  });
});
