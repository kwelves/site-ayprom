import { expectNoSeriousOrCriticalA11yViolations } from "../support/a11y";
import { allowExpectedDocumentStatus, expect, test } from "../support/browser-observer";

const CASES = [
  { name: "root", pathname: "/qa-e2e-global-not-found" },
  { name: "public", pathname: "/about/qa-e2e-global-not-found" },
] as const;

for (const target of CASES) {
  test(`[QA-008] unknown ${target.name} URL получает полный Russian global 404`, async ({ page, browserObserver }, testInfo) => {
    browserObserver.allow(allowExpectedDocumentStatus(target.pathname, 404));

    const response = await page.goto(target.pathname);
    expect(response?.status()).toBe(404);
    await expect(page.locator("body[data-global-not-found]")).toBeVisible();
    browserObserver.assertClean();

    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await expect(page.locator("html > body > main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1, name: "Страница не найдена" })).toBeVisible();
    await expect(page).toHaveTitle("Страница не найдена — AYPROM");
    await expect(page.locator('meta[name="robots"]')).toHaveCount(1);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("link", { name: "Открыть каталог" })).toHaveAttribute("href", "/catalog");
    await expect(page.getByRole("link", { name: "На главную" })).toHaveAttribute("href", "/");
    await expectNoSeriousOrCriticalA11yViolations(page, testInfo);

    await testInfo.attach(`qa-008-${target.name}-global-404.png`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });
}
