import { expectNoSeriousOrCriticalA11yViolations } from "../support/a11y";
import { allowExpectedInvalidLoginPostAbort, expect, test } from "../support/browser-observer";
import { cleanupLocalLoginAttempt } from "../support/local-auth";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("@smoke admin login UX", () => {
  test("неверный пароль показывает безопасную ошибку", async ({ page, browserObserver }) => {
    await cleanupLocalLoginAttempt();
    try {
      await page.goto("/admin/login");
      await page.getByLabel("Пароль").fill("qa-e2e-deliberately-wrong-password");
      browserObserver.allow(allowExpectedInvalidLoginPostAbort());
      await page.getByRole("button", { name: "Войти" }).click();
      await expect(page).toHaveURL(/\/admin\/login\?error=1$/);
      const loginForm = page.locator("form").filter({ has: page.getByLabel("Пароль") });
      await expect(loginForm.getByRole("alert")).toContainText("Неверный пароль");
    } finally {
      await cleanupLocalLoginAttempt();
    }
  });

  test("rate-limit состояние имеет alert и понятный retry", async ({ page }, testInfo) => {
    await page.goto("/admin/login?error=rate&retry=60");
    const loginForm = page.locator("form").filter({ has: page.getByLabel("Пароль") });
    await expect(loginForm.getByRole("alert")).toContainText("Слишком много попыток");
    await expectNoSeriousOrCriticalA11yViolations(page, testInfo);
  });

  test("пароль и submit доступны по keyboard path", async ({ page }) => {
    await page.goto("/admin/login");
    const password = page.getByLabel("Пароль");
    await password.focus();
    await expect(password).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Войти" })).toBeFocused();
  });
});
