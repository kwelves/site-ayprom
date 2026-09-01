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

describe("generateProductImageVariants", () => {
  it("создаёт оба варианта в WebP, вписывая их в свои границы без искажения пропорций", async () => {
    // 3000×2000 — крупнее обеих границ, соотношение 3:2.
    const { thumbnail, gallery } = await generateProductImageVariants(await jpeg(3000, 2000), target);

    const thumbMeta = await sharp(thumbnail.body).metadata();
    const galleryMeta = await sharp(gallery.body).metadata();

    expect(thumbMeta.format).toBe("webp");
    expect(galleryMeta.format).toBe("webp");
    // fit: "inside" — длинная сторона ложится ровно в границу.
    expect(thumbMeta.width).toBe(THUMBNAIL_VARIANT.maxSide);
    expect(thumbMeta.height).toBe(Math.round((THUMBNAIL_VARIANT.maxSide * 2) / 3));
    expect(galleryMeta.width).toBe(GALLERY_VARIANT.maxSide);
    expect(galleryMeta.height).toBe(Math.round((GALLERY_VARIANT.maxSide * 2) / 3));
  });

  it("не увеличивает исходник меньше границы варианта", async () => {
    const { thumbnail, gallery } = await generateProductImageVariants(await jpeg(320, 240), target);

    expect((await sharp(thumbnail.body).metadata()).width).toBe(320);
    expect((await sharp(gallery.body).metadata()).width).toBe(320);
  });

  it("считает thumbnail из master, а не из gallery", async () => {
    // Прямая проверка независимости: thumbnail, посчитанный из master,
    // отличается от пересжатого gallery. Если бы генератор строил
    // thumbnail из gallery, буферы совпали бы.
    const master = await noisyJpeg(3000, 2000);
    const { thumbnail, gallery } = await generateProductImageVariants(master, target);

    const thumbFromGallery = await sharp(gallery.body)
      .resize({ width: THUMBNAIL_VARIANT.maxSide, height: THUMBNAIL_VARIANT.maxSide, fit: "inside" })
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

    const { gallery } = await generateProductImageVariants(transparent, target);
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
    expect(thumbnail.path).toMatch(/^gear-pump\/[0-9a-f-]+\/variants\/v1\/thumbnail-[0-9a-f]{16}\.webp$/);
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
    expect(THUMBNAIL_VARIANT).toMatchObject({ maxSide: 640, quality: 72 });
    expect(GALLERY_VARIANT).toMatchObject({ maxSide: 1600, quality: 82 });
  });
});
