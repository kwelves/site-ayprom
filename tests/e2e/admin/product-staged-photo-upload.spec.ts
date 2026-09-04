import path from "node:path";
import { MAX_SERVER_ACTION_FILE_BYTES } from "@/lib/admin/compress-image";
import {
  cleanupOwnedCategory,
  cleanupOwnedProduct,
  countOwnedProductImages,
  createOwnedCategoryFixture,
  createOwnedProductFixture,
  downloadOwnedProductImageObject,
  E2E_PRODUCT_PREFIX,
  readOwnedProductImages,
} from "../support/local-products";
import {
  allowExpectedNextActionPostAbort,
  allowExpectedNextRscNavigationAbort,
  expect,
  test,
} from "../support/browser-observer";

// QA-004: раньше все фотографии ехали внутри одного запроса сохранения товара.
// Теперь браузер грузит каждый файл заранее и напрямую в приватное
// промежуточное хранилище, а сервер переносит его в публичное только после
// повторной проверки содержимого.
//
// Этот сценарий проходит весь путь целиком: выбор файла → независимая загрузка
// с видимым ходом → сохранение товара → фотография действительно прикреплена.
// Ни один другой тест этого не покрывает: CRUD-сценарий создаёт товар без фото.

/**
 * Настоящая картинка, а не вырожденная 1x1: сервер прогоняет фото через
 * обработку по выбранному режиму, и на однопиксельном изображении она даёт
 * пустой результат, который затем не открывается оптимизатором картинок.
 * Непрозрачный прямоугольник — минимальный осмысленный вход для этого пути.
 */
async function buildTestPhoto(): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 20, g: 80, b: 200, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

/**
 * Детерминированный высокоэнтропийный PNG с настоящим альфа-каналом. Он
 * заведомо больше порога клиентского сжатия (300 КБ), поэтому проверяет не
 * исходный PNG, а именно ветку PNG -> WebP без белой подложки.
 */
async function buildDetailedTransparentPhoto(): Promise<Buffer> {
  const width = 1200;
  const height = 900;
  const pixels = Buffer.allocUnsafe(width * height * 4);
  let state = 0x6d2b79f5;
  for (let index = 0; index < pixels.length; index += 4) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    pixels[index] = state & 0xff;
    pixels[index + 1] = (state >>> 8) & 0xff;
    pixels[index + 2] = (state >>> 16) & 0xff;
    // Не полностью прозрачный шум: изображение остаётся содержательным, а
    // alpha_is_used гарантированно присутствует в итоговом WebP.
    pixels[index + 3] = 48 + ((state >>> 24) & 0xcf);
  }

  const sharp = (await import("sharp")).default;
  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

test("[QA-004] фотография грузится отдельно и прикрепляется к товару при сохранении", async ({
  page,
  browserObserver,
}) => {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slug = `${E2E_PRODUCT_PREFIX}${unique}`;
  const category = await createOwnedCategoryFixture();

  try {
    await page.goto("/admin/products/new");
    await page.getByLabel("Название").fill(`QA staged ${unique}`);
    await page.getByLabel("Адрес (slug)").fill(slug);
    await page.getByLabel("Категория", { exact: true }).selectOption(category.slug);

    // Пропуск на загрузку запрашивается серверным действием, то есть тем же
    // POST на текущий адрес: разрешение регистрируется ДО выбора файла, иначе
    // его обрыв при последующем переходе будет считаться посторонним сбоем.
    browserObserver.allow(allowExpectedNextActionPostAbort("/admin/products/new"));

    // Файл выбирается — и загрузка начинается сразу, до сохранения товара.
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "qa-staged.png",
      mimeType: "image/png",
      buffer: await buildTestPhoto(),
    });

    // Ход загрузки виден администратору, и по её завершении появляется отметка.
    await expect(page.getByText("Загружено")).toBeVisible({ timeout: 30_000 });

    browserObserver.allow(allowExpectedNextRscNavigationAbort("/admin/products"));
    await page.getByRole("button", { name: "Создать товар" }).click();
    await expect(page).toHaveURL(/\/admin\/products(?:\?.*)?$/);

    // Главное: фотография действительно перенесена в публичное хранилище и
    // привязана к товару, а не осталась в промежуточном.
    await expect.poll(() => countOwnedProductImages(slug), { timeout: 30_000 }).toBe(1);

    const [image] = await readOwnedProductImages(slug);
    expect(image.url).toContain(`/${slug}/`);
    expect(image.thumbnail_url).toMatch(/\/variants\/v2\/thumbnail-[0-9a-f]{16}\.webp$/);
    expect(image.gallery_url).toMatch(/\/variants\/v1\/gallery-[0-9a-f]{16}\.webp$/);

    const sharp = (await import("sharp")).default;
    const thumbnail = await downloadOwnedProductImageObject(slug, image.thumbnail_url!);
    const gallery = await downloadOwnedProductImageObject(slug, image.gallery_url!);
    expect(thumbnail).not.toBeNull();
    expect(gallery).not.toBeNull();
    expect((await sharp(thumbnail!).metadata()).format).toBe("webp");
    expect((await sharp(gallery!).metadata()).format).toBe("webp");
  } finally {
    try {
      await cleanupOwnedProduct(slug);
    } finally {
      await cleanupOwnedCategory(category);
    }
  }
});

test("генерирует варианты при загрузке реалистичного фото в edit и удаляет master вместе с ними", async ({
  page,
  browserObserver,
}) => {
  const category = await createOwnedCategoryFixture();
  const slug = await createOwnedProductFixture(category.slug, "QA image variants edit");

  try {
    await page.goto(`/admin/products/${slug}/edit`);
    await page.getByRole("button", { name: "Фотографии" }).click();
    // После получения return value клиенту Next может оборвать оставшийся
    // RSC-хвост Server Action; данные и UI ниже подтверждают завершение самой
    // операции, поэтому разрешаем только этот точный POST текущего маршрута.
    browserObserver.allow(allowExpectedNextActionPostAbort(`/admin/products/${slug}/edit`));
    const upload = page.locator("label", { hasText: "Загрузить фото" }).locator('input[type="file"]');
    await upload.setInputFiles(path.join(process.cwd(), "public", "category-hydraulic-pumps", "1-gear-pumps.jpg"));

    await expect.poll(async () => (await readOwnedProductImages(slug)).length, { timeout: 30_000 }).toBe(1);

    const [image] = await readOwnedProductImages(slug);
    await expect(page.getByText(image.url, { exact: true })).toBeVisible();
    expect(image.url).toMatch(/\/master\.jpe?g$/);
    expect(image.thumbnail_url).toMatch(/\/variants\/v2\/thumbnail-[0-9a-f]{16}\.webp$/);
    expect(image.gallery_url).toMatch(/\/variants\/v1\/gallery-[0-9a-f]{16}\.webp$/);

    const [master, thumbnail, gallery] = await Promise.all([
      downloadOwnedProductImageObject(slug, image.url),
      downloadOwnedProductImageObject(slug, image.thumbnail_url!),
      downloadOwnedProductImageObject(slug, image.gallery_url!),
    ]);
    expect(master).not.toBeNull();
    expect(thumbnail).not.toBeNull();
    expect(gallery).not.toBeNull();

    const sharp = (await import("sharp")).default;
    const [masterMeta, thumbnailMeta, galleryMeta] = await Promise.all([
      sharp(master!).metadata(),
      sharp(thumbnail!).metadata(),
      sharp(gallery!).metadata(),
    ]);
    expect(masterMeta).toMatchObject({ format: "jpeg", width: 1200, height: 900 });
    expect(thumbnailMeta).toMatchObject({ format: "webp", width: 640, height: 480 });
    expect(galleryMeta).toMatchObject({ format: "webp", width: 1200, height: 900 });

    const imageRow = page.getByText(image.url, { exact: true }).locator("..");
    await imageRow.getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByText("Фотография удалена")).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await readOwnedProductImages(slug)).length).toBe(0);

    await expect.poll(() => downloadOwnedProductImageObject(slug, image.url)).toBeNull();
    await expect.poll(() => downloadOwnedProductImageObject(slug, image.thumbnail_url!)).toBeNull();
    await expect.poll(() => downloadOwnedProductImageObject(slug, image.gallery_url!)).toBeNull();
  } finally {
    try {
      await cleanupOwnedProduct(slug);
    } finally {
      await cleanupOwnedCategory(category);
    }
  }
});

test("адаптивно загружает детализированный PNG и сохраняет альфа-канал", async ({
  page,
  browserObserver,
}) => {
  const category = await createOwnedCategoryFixture();
  const slug = await createOwnedProductFixture(category.slug, "QA image alpha edit");

  try {
    const source = await buildDetailedTransparentPhoto();
    expect(source.byteLength).toBeGreaterThan(MAX_SERVER_ACTION_FILE_BYTES);

    await page.goto(`/admin/products/${slug}/edit`);
    await page.getByRole("button", { name: "Фотографии" }).click();
    browserObserver.allow(allowExpectedNextActionPostAbort(`/admin/products/${slug}/edit`));

    const upload = page.locator("label", { hasText: "Загрузить фото" }).locator('input[type="file"]');
    await upload.setInputFiles({
      name: "detailed-alpha.png",
      mimeType: "image/png",
      buffer: source,
    });

    // Сборка E2E использует bodySizeLimit=4mb. Успешный Server Action здесь
    // одновременно доказывает, что весь multipart body уложился в этот предел.
    await expect.poll(async () => (await readOwnedProductImages(slug)).length, { timeout: 45_000 }).toBe(1);

    const [image] = await readOwnedProductImages(slug);
    expect(image.url).toMatch(/\/master\.webp$/);
    expect(image.thumbnail_url).toMatch(/\/variants\/v2\/thumbnail-[0-9a-f]{16}\.webp$/);
    expect(image.gallery_url).toMatch(/\/variants\/v1\/gallery-[0-9a-f]{16}\.webp$/);

    const [master, thumbnail, gallery] = await Promise.all([
      downloadOwnedProductImageObject(slug, image.url),
      downloadOwnedProductImageObject(slug, image.thumbnail_url!),
      downloadOwnedProductImageObject(slug, image.gallery_url!),
    ]);
    expect(master).not.toBeNull();
    expect(thumbnail).not.toBeNull();
    expect(gallery).not.toBeNull();
    expect(master!.byteLength).toBeLessThanOrEqual(MAX_SERVER_ACTION_FILE_BYTES);

    const sharp = (await import("sharp")).default;
    const metadata = await Promise.all([
      sharp(master!).metadata(),
      sharp(thumbnail!).metadata(),
      sharp(gallery!).metadata(),
    ]);
    for (const item of metadata) {
      expect(item.format).toBe("webp");
      expect(item.hasAlpha).toBe(true);
    }

    const imageRow = page.getByText(image.url, { exact: true }).locator("..");
    await imageRow.getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByText("Фотография удалена")).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await readOwnedProductImages(slug)).length).toBe(0);
    await expect.poll(() => downloadOwnedProductImageObject(slug, image.url)).toBeNull();
    await expect.poll(() => downloadOwnedProductImageObject(slug, image.thumbnail_url!)).toBeNull();
    await expect.poll(() => downloadOwnedProductImageObject(slug, image.gallery_url!)).toBeNull();
  } finally {
    try {
      await cleanupOwnedProduct(slug);
    } finally {
      await cleanupOwnedCategory(category);
    }
  }
});
