import { expect, test } from "../support/browser-observer";
import { HERO_VIDEO_PATH_FRAGMENT, stubLocalHeroVideo } from "../support/media";
import { assertCriticalControlsInsideViewport, assertNoHorizontalOverflow } from "../support/responsive";

// QA-002 и QA-003 закрыты в фазе 2 и намеренно не имеют браузерных проб здесь.
//
// Их суть — поведение базы при сбое и при некорректном входе, а браузер не может
// ни прервать транзакцию на середине, ни отправить набор идентификаторов, которого
// интерфейс не формирует. Проба, «проверяющая» это через UI, была бы имитацией.
//
// Где доказано на самом деле:
//   QA-002 — supabase/tests/database/atomic_product_mutations.test.sql (откат
//            после вставки, конфликт версий) и admin/product-crud.spec.ts,
//            где проверяется видимость отказа для администратора;
//   QA-003 — supabase/tests/database/reorder_contracts.test.sql (дубликаты,
//            чужие и неизвестные идентификаторы, семантика слотов) и
//            tests/reorder-scope-arguments.test.ts (передача родителя в RPC).

test.fixme("[QA-004] create загружает несколько файлов независимо через staging", async () => {
  // Pending phase 3: current create-mode still sends one multipart Server Action request and no private staging exists.
});

test.fixme("[QA-005] blocked login не выполняет PBKDF2", async () => {
  // Pending phase 4: browser timing is insufficient; reservation RPC and server-side instrumentation are required.
});

test("[QA-006] hero не передаёт video до visibility/network gate", async ({ page, browserObserver }, testInfo) => {
  const videoRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(HERO_VIDEO_PATH_FRAGMENT)) videoRequests.push(new URL(request.url()).pathname);
  });
  await stubLocalHeroVideo(page);
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  const video = page.locator("video").first();
  await expect(video).toBeVisible();
  browserObserver.assertClean();
  const actual = await video.evaluate((element) => ({
    hasPoster: Boolean(element.getAttribute("poster")?.trim()),
    hasAutoplay: element.hasAttribute("autoplay"),
    preload: element.getAttribute("preload"),
  }));
  const target = { ...actual, requestCount: videoRequests.length };
  await testInfo.attach("qa-006-video-requests.json", {
    body: Buffer.from(JSON.stringify({ target, videoRequests }, null, 2)),
    contentType: "application/json",
  });
  const defectObserved = !target.hasPoster || target.hasAutoplay || target.preload !== "none" || target.requestCount > 0;
  test.fail(defectObserved, "QA-006: hero начинает video path без poster-first visibility/network gate.");
  expect(target).toEqual({ hasPoster: true, hasAutoplay: false, preload: "none", requestCount: 0 });
});

test("[QA-009] login имеет semantic main", async ({ page, browserObserver }) => {
  const response = await page.goto("/admin/login");
  expect(response?.status()).toBe(200);
  await expect(page.locator("body")).toBeVisible();
  browserObserver.assertClean();
  const mainCount = await page.getByRole("main").count();
  const defectObserved = mainCount !== 1;
  test.fail(defectObserved, "QA-009: login document не содержит ровно один semantic <main>.");
  expect(mainCount).toBe(1);
});

test("[QA-010] узкий login viewport не имеет overflow и clipped controls", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/admin/login");
  await assertNoHorizontalOverflow(page, testInfo, "qa-010-admin-login-320x800");
  await assertCriticalControlsInsideViewport(
    page,
    testInfo,
    "qa-010-admin-login-320x800",
    [
      { name: "login password", locator: page.getByLabel("Пароль") },
      { name: "login submit", locator: page.getByRole("button", { name: "Войти" }) },
      { name: "return to site", locator: page.getByRole("link", { name: "Вернуться на сайт" }) },
    ],
  );
  await testInfo.attach("qa-010-admin-login-320x800.png", {
    body: await page.screenshot({ fullPage: true, animations: "disabled" }),
    contentType: "image/png",
  });
});

test("[QA-011] production response не раскрывает X-Powered-By", async ({ page, browserObserver }) => {
  await stubLocalHeroVideo(page);
  const response = await page.goto("/");
  if (!response) throw new Error("QA-011 prerequisite: document response отсутствует.");
  expect(response.status()).toBe(200);
  await expect(page.locator("body")).toBeVisible();
  browserObserver.assertClean();
  const poweredBy = response.headers()["x-powered-by"];
  const defectObserved = poweredBy !== undefined;
  test.fail(defectObserved, "QA-011: production document раскрывает X-Powered-By.");
  expect(poweredBy).toBeUndefined();
});

// QA-012 состоит из двух половин, и закрыта пока одна.
//
// Границы масштаба закрыты в фазе 2: значения измерены по реальным данным,
// закреплены в UI, на сервере и CHECK-констрейнтами в базе. Доказано в
// supabase/tests/database/visual_scale_bounds.test.sql и tests/visual-scale.test.ts.
// Браузерной пробы здесь нет намеренно: последний рубеж — констрейнт базы,
// а через интерфейс до него не добраться.
//
// Вторая половина ниже остаётся открытой.
test.fixme("[QA-012] server-side content validation отвергает spoofed формат файла", async () => {
  // Pending phase 3: проверка содержимого загружаемого файла (а не только имени и
  // MIME) появится вместе со staged upload — см. QA-004.
});
