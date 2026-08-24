import {
  cleanupOwnedCategory,
  cleanupOwnedProduct,
  createOwnedCategoryFixture,
  E2E_PRODUCT_PREFIX,
  expectOwnedProductAbsent,
} from "../support/local-products";
import {
  allowExpectedNextActionPostAbort,
  allowExpectedNextRscNavigationAbort,
  expect,
  test,
} from "../support/browser-observer";

test.describe.configure({ mode: "serial" });

test("@smoke создаёт, редактирует и удаляет только свой товар без фотографии", async ({ page, browserObserver }) => {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slug = `${E2E_PRODUCT_PREFIX}${unique}`;
  const initialName = `QA E2E ${unique}`;
  const updatedName = `${initialName} updated`;
  const category = await createOwnedCategoryFixture();

  try {
    await page.goto("/admin/products/new");
    await page.getByLabel("Название").fill(initialName);
    await page.getByLabel("Адрес (slug)").fill(slug);
    await page.getByLabel("Категория", { exact: true }).selectOption(category.slug);
    browserObserver.allow(allowExpectedNextActionPostAbort("/admin/products/new"));
    browserObserver.allow(allowExpectedNextRscNavigationAbort("/admin/products"));
    await page.getByRole("button", { name: "Создать товар" }).click();
    await expect(page).toHaveURL(/\/admin\/products(?:\?.*)?$/);

    await page.goto(`/admin/products/${slug}/edit`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(initialName);
    await page.getByLabel("Название").fill(updatedName);
    browserObserver.allow(allowExpectedNextActionPostAbort(`/admin/products/${slug}/edit`));
    browserObserver.allow(allowExpectedNextRscNavigationAbort("/admin/products"));
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page).toHaveURL(/\/admin\/products(?:\?.*)?$/);

    await page.goto(`/admin/products/${slug}/edit`);
    await expect(page.getByLabel("Название")).toHaveValue(updatedName);
    browserObserver.allow(allowExpectedNextActionPostAbort(`/admin/products/${slug}/edit`));
    await page.getByRole("button", { name: "Удалить товар" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    browserObserver.allow(allowExpectedNextRscNavigationAbort("/admin/products"));
    await dialog.getByRole("button", { name: "Удалить" }).click();
    await expect(page).toHaveURL(/\/admin\/products(?:\?.*)?$/);
    await expect.poll(() => expectOwnedProductAbsent(slug)).toBe(true);
  } finally {
    try {
      await cleanupOwnedProduct(slug);
    } finally {
      await cleanupOwnedCategory(category);
    }
  }
});
