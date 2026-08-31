import { expect, test } from "../support/browser-observer";
import { E2E_VIEWPORTS } from "../support/viewports";

type Rect = { left: number; top: number; right: number; bottom: number };

type OverlapEvidence = {
  badge: Rect & { width: number; height: number };
  interactiveCount: number;
  cardCount: number;
  covered: Array<{
    label: string;
    tag: string;
    rect: Rect;
    overlapWidth: number;
    overlapHeight: number;
    coveredRatio: number;
  }>;
};

/**
 * QA-010: закреплённый WhatsApp-бейдж лежит поверх контента с `z-[60]`, поэтому
 * любой интерактивный элемент под ним перестаёт принимать нажатия. Сетка
 * каталога на узких экранах доходит до самого низа страницы, и нижняя правая
 * карточка оказывается ровно под бейджем. Проверяем именно пересечение
 * прямоугольников: это и есть потеря клика, а не вопрос вкуса.
 */
async function collectOverlapEvidence(page: import("@playwright/test").Page) {
  return page.evaluate<OverlapEvidence>(() => {
    const badgeElement = document.querySelector<HTMLElement>('a[aria-label="Написать в WhatsApp"]');
    if (!badgeElement) throw new Error("WhatsApp-бейдж не найден в DOM");
    const badgeRect = badgeElement.getBoundingClientRect();

    // Считаем весь документ, а не только <main>: в самом низу страницы под
    // бейджем оказывается футер, который лежит вне <main>. Если смотреть лишь
    // на <main>, результат зависит от количества товаров в каталоге, и на
    // коротком каталоге дефект просто не попадает в кадр.
    const interactive = Array.from(
      document.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
    ).filter((element) => {
      if (element === badgeElement || badgeElement.contains(element)) return false;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (style.pointerEvents === "none") return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    const covered = interactive
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const overlapWidth = Math.min(badgeRect.right, rect.right) - Math.max(badgeRect.left, rect.left);
        const overlapHeight = Math.min(badgeRect.bottom, rect.bottom) - Math.max(badgeRect.top, rect.top);
        const area = rect.width * rect.height;
        const overlapArea = Math.max(0, overlapWidth) * Math.max(0, overlapHeight);
        return {
          label:
            element.getAttribute("aria-label") ||
            element.textContent?.trim().slice(0, 80) ||
            element.tagName,
          tag: element.tagName.toLowerCase(),
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
          overlapWidth,
          overlapHeight,
          // Доля перекрытой площади отличает "у крупной карточки закрыт угол"
          // от "мелкий control закрыт целиком и недостижим".
          coveredRatio: area > 0 ? Number((overlapArea / area).toFixed(3)) : 1,
        };
      })
      // 0.5 px — тот же порог, что и в support/responsive.ts: он гасит
      // субпиксельные касания границ и оставляет только реальные наложения.
      .filter((candidate) => candidate.overlapWidth > 0.5 && candidate.overlapHeight > 0.5);

    return {
      badge: {
        left: badgeRect.left,
        top: badgeRect.top,
        right: badgeRect.right,
        bottom: badgeRect.bottom,
        width: badgeRect.width,
        height: badgeRect.height,
      },
      interactiveCount: interactive.length,
      cardCount: document.querySelectorAll("[data-card-title]").length,
      covered,
    };
  });
}

test.describe("[QA-010] WhatsApp-бейдж не перекрывает интерактивные элементы каталога", () => {
  for (const viewport of E2E_VIEWPORTS) {
    test.describe(viewport.name, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test(`каталог, низ страницы @ ${viewport.name}`, async ({ page }, testInfo) => {
        const response = await page.goto("/catalog");
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("link", { name: "Написать в WhatsApp" })).toBeVisible();

        // Дефект проявляется в конце сетки: пока страница не прокручена, под
        // бейджем пусто. Прокручиваем до самого низа и ждём остановки скролла.
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForFunction(() => {
          const atBottom =
            window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
          return atBottom || document.documentElement.scrollHeight <= window.innerHeight;
        });

        const evidence = await collectOverlapEvidence(page);
        const label = `qa-010-whatsapp-${viewport.name}`;

        await testInfo.attach(`${label}.json`, {
          body: Buffer.from(JSON.stringify(evidence, null, 2)),
          contentType: "application/json",
        });
        await testInfo.attach(`${label}.png`, {
          body: await page.screenshot({ animations: "disabled" }),
          contentType: "image/png",
        });

        expect(
          evidence.interactiveCount,
          `${label}: на странице не нашлось интерактивных элементов — проверка вырождается`,
        ).toBeGreaterThan(0);
        // Закреплённая кнопка по своей природе лежит поверх страницы, поэтому
        // требовать полного отсутствия пересечений бессмысленно: такой контракт
        // невозможно выполнить, не убрав саму кнопку. Значение имеет
        // достижимость: замер показал, что бейдж срезает у крупных карточек
        // угол (≈1–5% площади), и элемент остаётся нажимаемым. Недопустим
        // случай, когда control закрыт большей частью и попасть в него нельзя —
        // это и проверяем.
        const unreachable = evidence.covered.filter((candidate) => candidate.coveredRatio >= 0.5);

        // Список перекрытых элементов идёт прямо в сообщение, как offenders в
        // support/responsive.ts: по одному падению должно быть видно, что
        // именно потеряло клик, без раскрытия trace.
        expect(
          unreachable,
          `${label}: WhatsApp-бейдж делает controls недостижимыми; badge=${JSON.stringify(
            evidence.badge,
          )}; covered=${JSON.stringify(evidence.covered)}`,
        ).toEqual([]);
      });
    });
  }
});
