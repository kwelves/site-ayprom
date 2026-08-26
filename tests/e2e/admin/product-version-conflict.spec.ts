import {
  cleanupOwnedCategory,
  cleanupOwnedProduct,
  createOwnedCategoryFixture,
  createOwnedProductFixture,
  readOwnedProductName,
  touchOwnedProduct,
} from "../support/local-products";
import { allowExpectedNextActionPostAbort, expect, test } from "../support/browser-observer";

// QA-002, вторая половина: прежде правка из устаревшей вкладки молча затирала
// более новую редакцию.
//
// Сам механизм сравнения версий живёт в базе и доказан pgTAP
// (atomic_product_mutations.test.sql). Здесь проверяется то, чего pgTAP увидеть
// не может: доходит ли отказ до администратора видимым и понятным сообщением, и
// остаётся ли при этом чужая редакция нетронутой.
//
// Отдельный файл, а не соседство с product-crud.spec.ts: тот работает в
// последовательном режиме, и падение его первого сценария пропускало бы этот —
// проверка молча переставала бы что-либо доказывать.
test("[QA-002] устаревшая правка отклоняется и не затирает более новую редакцию", async ({
  page,
  browserObserver,
}) => {
  const category = await createOwnedCategoryFixture();
  const originalName = `QA CAS original ${Date.now()}`;
  const slug = await createOwnedProductFixture(category.slug, originalName);

  try {
    // Форма запоминает версию товара на момент открытия.
    await page.goto(`/admin/products/${slug}/edit`);
    await expect(page.getByLabel("Название")).toHaveValue(originalName);

    // Другой администратор сохраняет тот же товар — версия в базе уходит вперёд.
    await touchOwnedProduct(slug);

    await page.getByLabel("Название").fill(`${originalName} перезапись`);
    browserObserver.allow(allowExpectedNextActionPostAbort(`/admin/products/${slug}/edit`));
    await page.getByRole("button", { name: "Сохранить" }).click();

    // Отказ обязан быть видимым и называть причину, а не быть безликим:
    // именно на этом шаге ошибка теряла текст до исправления в фазе 2.
    await expect(page.getByRole("alert").filter({ hasText: "другим администратором" })).toBeVisible();

    // Перехода в список не происходит — админ остаётся на своей правке.
    await expect(page).toHaveURL(new RegExp(`/admin/products/${slug}/edit`));

    // И, главное, чужая редакция не затёрта.
    expect(await readOwnedProductName(slug)).toBe(originalName);
    browserObserver.assertClean();
  } finally {
    try {
      await cleanupOwnedProduct(slug);
    } finally {
      await cleanupOwnedCategory(category);
    }
  }
});
