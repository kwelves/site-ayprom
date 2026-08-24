import { allowExpectedDocumentStatus, expect, test } from "../support/browser-observer";

test("[QA-008] unknown admin URL получает полный Russian global 404", async ({ page, browserObserver }) => {
  const pathname = "/admin/qa-e2e-global-not-found";
  browserObserver.allow(allowExpectedDocumentStatus(pathname, 404));

  const response = await page.goto(pathname);
  expect(response?.status()).toBe(404);
  await expect(page.locator("body")).toBeVisible();
  browserObserver.assertClean();
  const headingText = await page.getByRole("heading", { level: 1 }).allTextContents();
  const actual = {
    lang: await page.locator("html").getAttribute("lang"),
    hasRussianHeading: headingText.some((text) => /страниц|не найден/i.test(text)),
  };
  const defectObserved = actual.lang !== "ru" || !actual.hasRussianHeading;
  test.fail(defectObserved, "QA-008: admin unknown route не получает полный Russian global 404 document.");
  expect(actual).toEqual({ lang: "ru", hasRussianHeading: true });
});
