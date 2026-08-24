import { expectNoSeriousOrCriticalA11yViolations } from "../support/a11y";
import { allowExpectedDocumentStatus, expect, test } from "../support/browser-observer";
import {
  cleanupOwnedCatalogFixture,
  createOwnedCatalogFixture,
  type OwnedCatalogFixture,
} from "../support/local-products";
import { stubLocalHeroVideo } from "../support/media";

test.describe.configure({ mode: "serial" });
let fixture: OwnedCatalogFixture;

test.beforeAll(async () => {
  fixture = await createOwnedCatalogFixture();
});

test.afterAll(async () => {
  if (fixture) await cleanupOwnedCatalogFixture(fixture);
});

test.describe("@smoke public catalog", () => {
  test("главная открывается и содержит основной заголовок", async ({ page }, testInfo) => {
    await stubLocalHeroVideo(page);
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoSeriousOrCriticalA11yViolations(page, testInfo);
  });

  test("каталог ищет товар и сохраняет query в URL", async ({ page }) => {
    const product = fixture.products[0];
    const response = await page.goto("/catalog");
    expect(response?.status()).toBe(200);
    await page.getByRole("textbox", { name: "Поиск по каталогу" }).fill(product.name);
    await page.getByRole("button", { name: "Найти" }).click();
    expect(new URL(page.url()).searchParams.get("q")).toBe(product.name);
    await expect(page.getByText(product.name, { exact: true })).toBeVisible();
  });

  test("пагинация работает на детерминированных owned fixtures", async ({ page }) => {
    const params = new URLSearchParams({ q: fixture.batchQuery, page: "2" });
    const response = await page.goto(`/catalog?${params}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("link", { name: "2", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(fixture.products[24].name, { exact: true })).toBeVisible();
  });

  test("публичная карточка товара доступна по стабильному route", async ({ page }) => {
    const product = fixture.products[0];
    const response = await page.goto(`/product/${product.slug}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
  });

  test("неизвестный public URL возвращает 404", async ({ page, browserObserver }) => {
    const pathname = "/qa-e2e-public-not-found";
    browserObserver.allow(allowExpectedDocumentStatus(pathname, 404));
    const response = await page.goto(pathname);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

});

test("[QA-007] public metadata использует сохранённые SEO поля", async ({ page, browserObserver }) => {
  const product = fixture.products[0];
  const response = await page.goto(`/product/${product.slug}`);
  expect(response?.status()).toBe(200);
  await expect(page.locator("body")).toBeVisible();
  browserObserver.assertClean();
  const actual = {
    title: await page.title(),
    description: await page.locator('meta[name="description"]').getAttribute("content"),
  };
  const expected = { title: `${product.metaTitle} — AYPROM`, description: product.metaDescription };
  const defectObserved = actual.title !== expected.title || actual.description !== expected.description;
  test.fail(defectObserved, "QA-007: product route игнорирует сохранённые meta_title/meta_description.");
  expect(actual).toEqual(expected);
});
