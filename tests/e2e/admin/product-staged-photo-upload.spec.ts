import {
  cleanupOwnedCategory,
  cleanupOwnedProduct,
  countOwnedProductImages,
  createOwnedCategoryFixture,
  E2E_PRODUCT_PREFIX,
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
  } finally {
    try {
      await cleanupOwnedProduct(slug);
    } finally {
      await cleanupOwnedCategory(category);
    }
  }
});
