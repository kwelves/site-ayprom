import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test as setup } from "@playwright/test";
import { assertLocalAdminCredentialAbsent, cleanupLocalLoginAttempt } from "../support/local-auth";

const authFile = path.join(process.cwd(), ".playwright-state", "auth", "admin.json");

setup("@smoke authenticate admin against local Supabase", async ({ page }) => {
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!password) throw new Error("E2E_ADMIN_PASSWORD не задан local runtime wrapper.");

  await assertLocalAdminCredentialAbsent();
  await cleanupLocalLoginAttempt();

  await page.goto("/admin/login");
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/admin\/welcome(?:\?.*)?$/);

  await mkdir(path.dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
  await cleanupLocalLoginAttempt();
});
