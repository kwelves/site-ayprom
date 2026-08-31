import { expect, test } from "../support/browser-observer";
import { expectNoSeriousOrCriticalA11yViolations } from "../support/a11y";
import { heroTierOf, stubLocalHeroVideo, type HeroTier } from "../support/media";
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

// Прежняя проверка описывала отменённую концепцию (poster-first, без autoplay,
// ноль запросов до visibility/network gate) и держалась на `test.fail`. Она
// проверяла требование, которого больше нет. Утверждённая формулировка QA-006
// другая: первой запрашивается лёгкая ступень, заставка уходит по реальному
// движению, тяжёлая ступень догружается только потом.
test("[QA-006] hero запрашивает лёгкую ступень первой и снимает заставку по движению", async ({
  page,
  browserObserver,
}, testInfo) => {
  const videoRequests: { tier: HeroTier; path: string; at: number }[] = [];
  const startedAt = Date.now();
  page.on("request", (request) => {
    const tier = heroTierOf(request.url());
    if (tier) videoRequests.push({ tier, path: new URL(request.url()).pathname, at: Date.now() - startedAt });
  });
  await stubLocalHeroVideo(page);
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  // Адрес тяжёлой ступени проставляется кодом, а не разметкой. Проверяется
  // именно отданный сервером HTML: к моменту, когда до элемента доберётся
  // тест, код уже успевает проставить адрес, и чтение атрибута дало бы гонку.
  const html = await response!.text();
  expect(html).toContain("2026-08-27-startup/");
  expect(html).not.toContain("2026-08-18-2k/");

  const [startup] = await page.locator("video").all();
  await expect(startup).toBeVisible();

  // Заставка снимается по подтверждённому движению. Аварийный таймер тоже
  // снял бы её, но позже — поэтому запас здесь заведомо меньше него.
  await expect(page.getByRole("progressbar", { name: "Загрузка сайта" })).toBeHidden({ timeout: 4_000 });

  const first = videoRequests[0];
  const target = {
    firstTier: first?.tier ?? null,
    hasPoster: Boolean(await startup.getAttribute("poster")),
    startupPreload: await startup.getAttribute("preload"),
    startupAutoplay: await startup.evaluate((element) => element.hasAttribute("autoplay")),
  };
  await testInfo.attach("qa-006-video-requests.json", {
    body: Buffer.from(JSON.stringify({ target, videoRequests }, null, 2)),
    contentType: "application/json",
  });
  browserObserver.assertClean();

  expect(target).toEqual({
    firstTier: "startup",
    // Постера намеренно нет: hero начинается с первого кадра самого видео.
    hasPoster: false,
    startupPreload: "metadata",
    startupAutoplay: true,
  });
});

test("[QA-009] login имеет semantic main", async ({ page, browserObserver }, testInfo) => {
  const response = await page.goto("/admin/login");
  expect(response?.status()).toBe(200);
  await expect(page.locator("body")).toBeVisible();
  browserObserver.assertClean();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Вход в админку" })).toBeVisible();
  await expectNoSeriousOrCriticalA11yViolations(page, testInfo);
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
  // Никакого условного `test.fail` здесь быть не может. Условие вида
  // `test.fail(poweredBy !== undefined)` описывает не контракт, а факт: если
  // заголовок вернётся, проба объявит его «ожидаемым падением» и пройдёт.
  // Защита должна быть fail-closed — обычный обязательный expect.
  expect(response.headers()["x-powered-by"]).toBeUndefined();
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
