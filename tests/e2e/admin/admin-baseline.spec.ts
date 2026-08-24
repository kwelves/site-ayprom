import { expectNoSeriousOrCriticalA11yViolations } from "../support/a11y";
import { expect, test } from "../support/browser-observer";
import { assertCriticalControlsInsideViewport, assertNoHorizontalOverflow } from "../support/responsive";
import { E2E_VIEWPORTS } from "../support/viewports";

test("@smoke protected admin shell и product list доступны", async ({ page }, testInfo) => {
  const response = await page.goto("/admin/products");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoSeriousOrCriticalA11yViolations(page, testInfo);
});

test.describe("protected admin responsive evidence baseline", () => {
  for (const viewport of E2E_VIEWPORTS) {
    test.describe(viewport.name, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test(`products @ ${viewport.name}`, async ({ page }, testInfo) => {
        const response = await page.goto("/admin/products");
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("main")).toBeVisible();

        const label = `admin-products-${viewport.name}`;
        await assertNoHorizontalOverflow(page, testInfo, label);
        await assertCriticalControlsInsideViewport(
          page,
          testInfo,
          label,
          [
            { name: "add product", locator: page.getByRole("link", { name: "Добавить товар" }).first() },
            { name: "product search", locator: page.getByRole("searchbox", { name: "Поиск товаров" }) },
            { name: "category filter", locator: page.getByRole("combobox", { name: "Фильтр по категории" }) },
          ],
        );
        await testInfo.attach(`admin-products-${viewport.name}.png`, {
          body: await page.screenshot({ fullPage: true, animations: "disabled" }),
          contentType: "image/png",
        });
      });
    });
  }
});
