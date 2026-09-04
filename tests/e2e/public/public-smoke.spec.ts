import type { Locator, Page } from "@playwright/test";
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

/**
 * Проверки товара привязываются к основному содержимому страницы, а не к
 * документу целиком.
 *
 * При клиентской навигации (submit формы поиска, переход по странице
 * пагинации) App Router на короткое время держит в DOM оба сегмента: новый
 * уже вставлен, старый ещё не убран. Замерено: на ~300 мс карточка
 * существует вне `#main-content` и только потом попадает внутрь. Локатор по
 * всему документу в этот момент видит два одинаковых элемента и падает со
 * strict mode violation — при том, что пользователь видит корректную
 * страницу с одной карточкой.
 *
 * Привязка к `#main-content` убирает эту гонку и заодно делает проверку
 * строже по смыслу: товар обязан быть именно в основном содержимом, а не
 * где-либо в документе.
 */
function mainContent(page: Page) {
  return page.locator("#main-content");
}

async function hoverBorderAlignmentError(card: Locator, highlight: Locator): Promise<number> {
  const [cardBox, highlightBox] = await Promise.all([card.boundingBox(), highlight.boundingBox()]);
  if (!cardBox || !highlightBox) return Number.POSITIVE_INFINITY;

  return Math.max(
    Math.abs(cardBox.x - highlightBox.x - 5),
    Math.abs(cardBox.y - highlightBox.y - 5),
    Math.abs(highlightBox.width - cardBox.width - 10),
    Math.abs(highlightBox.height - cardBox.height - 10),
  );
}

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
    await expect(mainContent(page).getByText(product.name, { exact: true })).toBeVisible();
  });

  test("пагинация работает на детерминированных owned fixtures", async ({ page }) => {
    const params = new URLSearchParams({ q: fixture.batchQuery, page: "2" });
    const response = await page.goto(`/catalog?${params}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("link", { name: "2", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(mainContent(page).getByText(fixture.products[24].name, { exact: true })).toBeVisible();
  });

  test("публичная карточка товара доступна по стабильному route", async ({ page }) => {
    const product = fixture.products[0];
    const response = await page.goto(`/product/${product.slug}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
  });

  test("единый hover-border точно переезжает между карточками каталога", async ({ page, browserObserver }) => {
    const params = new URLSearchParams({ q: fixture.batchQuery });
    const response = await page.goto(`/catalog?${params}`);
    expect(response?.status()).toBe(200);

    const grid = mainContent(page).locator("[data-hover-border-grid]").first();
    const cards = grid.locator("[data-hover-border-item]");
    const highlight = grid.locator("[data-hover-border-highlight]");
    await expect(cards).toHaveCount(24);

    await cards.nth(0).hover();
    await expect(highlight).toHaveCount(1);
    await expect.poll(() => hoverBorderAlignmentError(cards.nth(0), highlight)).toBeLessThan(1);

    await cards.nth(1).hover();
    await expect(highlight).toHaveCount(1);
    await expect.poll(() => hoverBorderAlignmentError(cards.nth(1), highlight)).toBeLessThan(1);
    browserObserver.assertClean();
  });

  test("неизвестный public URL возвращает 404", async ({ page, browserObserver }) => {
    const pathname = "/qa-e2e-public-not-found";
    browserObserver.allow(allowExpectedDocumentStatus(pathname, 404));
    const response = await page.goto(pathname);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

});
