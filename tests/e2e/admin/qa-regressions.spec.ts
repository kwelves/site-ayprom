import { allowExpectedDocumentStatus, expect, test } from "../support/browser-observer";

test("[QA-008] unknown admin URL получает полный Russian global 404", async ({ page, browserObserver }, testInfo) => {
  const pathname = "/admin/qa-e2e-global-not-found";
  browserObserver.allow(allowExpectedDocumentStatus(pathname, 404));

  const response = await page.goto(pathname);
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

  await testInfo.attach("qa-008-admin-global-404.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});
