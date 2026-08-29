import type { Locator, Page } from "@playwright/test";
import { expectNoSeriousOrCriticalA11yViolations } from "../support/a11y";
import { allowExpectedNextRscNavigationAbort, expect, test } from "../support/browser-observer";

async function controlledElement(page: Page, control: Locator) {
  const id = await control.getAttribute("aria-controls");
  expect(id, "disclosure должен ссылаться на управляемую область через aria-controls").toBeTruthy();
  if (!id) throw new Error("aria-controls отсутствует");
  return page.locator(`[id="${id}"]`);
}

async function expectKeyboardFocusVisible(control: Locator) {
  await expect(control).toBeFocused();
  const isVisible = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    return element.matches(":focus-visible") && (style.outlineStyle !== "none" || style.boxShadow !== "none");
  });
  expect(isVisible, "keyboard focus должен иметь видимый outline или ring").toBe(true);
}

async function focusWithKeyboard(page: Page, control: Locator, maxTabs = 60) {
  for (let step = 0; step < maxTabs; step += 1) {
    if (await control.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(control, `control не получил фокус за ${maxTabs} последовательных Tab`).toBeFocused();
}

test("[QA-009] desktop dropdown связан с panel и Escape возвращает фокус", async ({
  page,
  browserObserver,
}, testInfo) => {
  const response = await page.goto("/contacts");
  expect(response?.status()).toBe(200);

  const trigger = page.locator("header nav").getByRole("link", { name: "Каталог", exact: true });
  await focusWithKeyboard(page, trigger);
  await expectKeyboardFocusVisible(trigger);
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  const panel = await controlledElement(page, trigger);
  await expect(panel).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("link").first()).toBeFocused();
  await page.keyboard.press("Escape");

  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expectKeyboardFocusVisible(trigger);
  await expect(panel).toBeHidden();
  browserObserver.assertClean();
  await expectNoSeriousOrCriticalA11yViolations(page, testInfo);
});

test("[QA-009] mobile disclosures закрываются по Escape с поэтапным возвратом фокуса", async ({
  page,
  browserObserver,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto("/contacts");
  expect(response?.status()).toBe(200);

  const menuToggle = page.locator("header button[aria-controls]").first();
  await expect(menuToggle).toHaveAccessibleName("Открыть меню");
  await focusWithKeyboard(page, menuToggle);
  await expectKeyboardFocusVisible(menuToggle);
  await page.keyboard.press("Enter");

  await expect(menuToggle).toHaveAccessibleName("Закрыть меню");
  await expect(menuToggle).toHaveAttribute("aria-expanded", "true");
  const menuPanel = await controlledElement(page, menuToggle);
  await expect(menuPanel).toBeVisible();

  const categoryToggle = page.locator('button[aria-label*="подраздел «Каталог»"]');
  await focusWithKeyboard(page, categoryToggle);
  await expectKeyboardFocusVisible(categoryToggle);
  await page.keyboard.press("Enter");

  await expect(categoryToggle).toHaveAccessibleName("Скрыть подраздел «Каталог»");
  await expect(categoryToggle).toHaveAttribute("aria-expanded", "true");
  const categoryPanel = await controlledElement(page, categoryToggle);
  await expect(categoryPanel).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(categoryPanel.getByRole("link").first()).toBeFocused();

  await testInfo.attach("qa-009-mobile-disclosures.png", {
    body: await page.screenshot({ fullPage: true, animations: "disabled" }),
    contentType: "image/png",
  });
  await expectNoSeriousOrCriticalA11yViolations(page, testInfo);

  await page.keyboard.press("Escape");
  await expect(categoryToggle).toHaveAccessibleName("Показать подраздел «Каталог»");
  await expect(categoryToggle).toHaveAttribute("aria-expanded", "false");
  await expectKeyboardFocusVisible(categoryToggle);
  await expect(menuToggle).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("Escape");
  await expect(menuToggle).toHaveAccessibleName("Открыть меню");
  await expect(menuToggle).toHaveAttribute("aria-expanded", "false");
  await expectKeyboardFocusVisible(menuToggle);
  await expect(menuPanel).toBeHidden();
  browserObserver.assertClean();
});

test("[QA-009] BackButton использует native back только для безопасной внутренней истории", async ({
  page,
  browserObserver,
}) => {
  const response = await page.goto("/contacts");
  expect(response?.status()).toBe(200);
  browserObserver.allow(allowExpectedNextRscNavigationAbort("/catalog"));
  await page.getByRole("link", { name: "Все товары" }).click();
  await expect(page).toHaveURL(/\/catalog$/);

  const backButton = page.getByRole("button", { name: "Назад" });
  await focusWithKeyboard(page, backButton);
  await expectKeyboardFocusVisible(backButton);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/contacts$/);
  browserObserver.assertClean();
});

test("[QA-009] прямой вход получает предсказуемый BackButton fallback", async ({ page, browserObserver }) => {
  const response = await page.goto("/catalog/category/pto");
  expect(response?.status()).toBe(200);
  browserObserver.allow(allowExpectedNextRscNavigationAbort("/catalog"));
  await page.getByRole("button", { name: "Назад" }).click();
  await expect(page).toHaveURL(/\/catalog$/);
  browserObserver.assertClean();
});
