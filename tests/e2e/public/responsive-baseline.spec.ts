import type { Page } from "@playwright/test";
import { expect, test } from "../support/browser-observer";
import { stubLocalHeroVideo } from "../support/media";
import {
  assertCriticalControlsInsideViewport,
  assertNoHorizontalOverflow,
  type RequiredControl,
} from "../support/responsive";
import { E2E_VIEWPORTS } from "../support/viewports";

function headerControls(page: Page, width: number): RequiredControl[] {
  return [
    { name: "AYPROM logo link", locator: page.getByRole("link", { name: "AYPROM", exact: true }).first() },
    width < 768
      ? { name: "mobile menu", locator: page.getByRole("button", { name: "Открыть меню" }) }
      : { name: "desktop catalog nav", locator: page.getByRole("navigation").getByRole("link", { name: "Каталог", exact: true }) },
  ];
}

const routes = [
  { name: "home", path: "/" },
  { name: "catalog", path: "/catalog" },
  { name: "admin-login", path: "/admin/login" },
] as const;

test.describe("responsive evidence baseline", () => {
  for (const viewport of E2E_VIEWPORTS) {
    test.describe(viewport.name, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      for (const route of routes) {
        test(`${route.name} @ ${viewport.name}`, async ({ page }, testInfo) => {
          if (route.name === "home") await stubLocalHeroVideo(page);
          const response = await page.goto(route.path);
          expect(response?.status()).toBe(200);
          await expect(page.locator("body")).toBeVisible();
          if (route.name === "home") {
            const header = page.locator("header");
            await expect(page.getByRole("progressbar", { name: "Загрузка сайта" })).toBeHidden({ timeout: 15_000 });
            await expect(header).toHaveAttribute("aria-hidden", "false", { timeout: 15_000 });
            await expect(header.getByRole("link", { name: "AYPROM", exact: true }).first()).toBeVisible({ timeout: 15_000 });
          }

          const label = `${route.name}-${viewport.name}`;
          await assertNoHorizontalOverflow(page, testInfo, label);
          const controls =
            route.name === "home"
              ? headerControls(page, viewport.width)
              : route.name === "catalog"
                ? [
                    { name: "catalog search", locator: page.getByRole("textbox", { name: "Поиск по каталогу" }) },
                    { name: "catalog submit", locator: page.getByRole("button", { name: "Найти" }) },
                  ]
                : [
                    { name: "login password", locator: page.getByLabel("Пароль") },
                    { name: "login submit", locator: page.getByRole("button", { name: "Войти" }) },
                    { name: "return to site", locator: page.getByRole("link", { name: "Вернуться на сайт" }) },
                  ];
          await assertCriticalControlsInsideViewport(page, testInfo, label, controls);
          await testInfo.attach(`${route.name}-${viewport.name}.png`, {
            body: await page.screenshot({ fullPage: true, animations: "disabled" }),
            contentType: "image/png",
          });
        });
      }
    });
  }
});
