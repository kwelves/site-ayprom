import { expect, test } from "../support/browser-observer";
import { stubLocalHeroVideo } from "../support/media";
import { E2E_VIEWPORTS } from "../support/viewports";

type Gap = { top: number; bottom: number; height: number; ratioOfViewport: number };

type GapEvidence = {
  documentHeight: number;
  viewportHeight: number;
  contentBands: number;
  gaps: Gap[];
  largestGap: Gap | null;
  neighbours: Array<{ above: string; below: string; gapHeight: number }>;
};

/**
 * QA-010 фиксирует «большой белый интервал при прокрутке», но источник в коде
 * статически не локализован. Ищем его замером: берём элементы, которые реально
 * что-то рисуют (текст, медиа, заливка фоном), переводим их в координаты
 * документа, склеиваем перекрывающиеся полосы и смотрим на разрывы между ними.
 * Разрыв — это полоса страницы, где не нарисовано ничего.
 */
async function collectGapEvidence(page: import("@playwright/test").Page, minGapRatio: number) {
  return page.evaluate<GapEvidence, number>((ratio) => {
    const viewportHeight = window.innerHeight;
    const minGap = viewportHeight * ratio;

    function describe(element: HTMLElement): string {
      const id = element.id ? `#${element.id}` : "";
      const cls =
        typeof element.className === "string" && element.className
          ? `.${element.className.trim().split(/\s+/).slice(0, 3).join(".")}`
          : "";
      return `${element.tagName.toLowerCase()}${id}${cls}`.slice(0, 120);
    }

    const painted: Array<{ top: number; bottom: number; element: HTMLElement }> = [];
    const mediaTags = new Set(["img", "svg", "video", "canvas", "picture", "iframe", "input", "textarea"]);

    for (const element of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;

      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      // Закреплённые элементы едут вместе с экраном и не занимают места в
      // потоке документа, поэтому они не могут закрывать разрыв.
      if (style.position === "fixed") continue;

      const tag = element.tagName.toLowerCase();
      const hasOwnText = Array.from(element.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim().length > 0,
      );
      const isMedia = mediaTags.has(tag);
      const hasBackgroundImage = style.backgroundImage !== "none";

      // Заливка фоном и рамка намеренно НЕ считаются содержимым: искомый
      // «белый интервал» — это как раз полоса, залитая фоном страницы и
      // пустая внутри. Если засчитывать заливку, детектор перестаёт видеть
      // ровно тот дефект, ради которого написан.
      if (!hasOwnText && !isMedia && !hasBackgroundImage) continue;

      painted.push({
        top: rect.top + window.scrollY,
        bottom: rect.bottom + window.scrollY,
        element,
      });
    }

    painted.sort((first, second) => first.top - second.top);

    const bands: Array<{ top: number; bottom: number; last: HTMLElement; first: HTMLElement }> = [];
    for (const entry of painted) {
      const current = bands[bands.length - 1];
      if (current && entry.top <= current.bottom) {
        if (entry.bottom > current.bottom) {
          current.bottom = entry.bottom;
          current.last = entry.element;
        }
        continue;
      }
      bands.push({ top: entry.top, bottom: entry.bottom, first: entry.element, last: entry.element });
    }

    const gaps: Gap[] = [];
    const neighbours: Array<{ above: string; below: string; gapHeight: number }> = [];
    for (let index = 1; index < bands.length; index += 1) {
      const gapHeight = bands[index].top - bands[index - 1].bottom;
      if (gapHeight < minGap) continue;
      gaps.push({
        top: bands[index - 1].bottom,
        bottom: bands[index].top,
        height: gapHeight,
        ratioOfViewport: Number((gapHeight / viewportHeight).toFixed(2)),
      });
      neighbours.push({
        above: describe(bands[index - 1].last),
        below: describe(bands[index].first),
        gapHeight,
      });
    }

    return {
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight,
      contentBands: bands.length,
      gaps,
      largestGap: gaps.reduce<Gap | null>(
        (largest, gap) => (largest === null || gap.height > largest.height ? gap : largest),
        null,
      ),
      neighbours,
    };
  }, minGapRatio);
}

// Порог: разрыв больше четверти экрана пользователь уже воспринимает как
// «пустое место», меньший считаем обычным ритмом секций.
const MIN_GAP_RATIO = 0.25;

const routes = [
  { name: "home", path: "/" },
  { name: "catalog", path: "/catalog" },
  { name: "category", path: "/catalog/category/pto" },
] as const;

test.describe("[QA-010] на странице нет крупных пустых интервалов", () => {
  for (const viewport of E2E_VIEWPORTS) {
    test.describe(viewport.name, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      for (const route of routes) {
        test(`${route.name} @ ${viewport.name}`, async ({ page }, testInfo) => {
          if (route.name === "home") await stubLocalHeroVideo(page);
          const response = await page.goto(route.path);
          expect(response?.status()).toBe(200);
          if (route.name === "home") {
            await expect(page.getByRole("progressbar", { name: "Загрузка сайта" })).toBeHidden({
              timeout: 15_000,
            });
          }

          // Секции появляются по мере попадания в экран, поэтому сначала
          // прокручиваем страницу целиком: иначе ещё не раскрытый блок будет
          // выглядеть как пустота и даст ложную находку.
          await page.evaluate(async () => {
            const step = window.innerHeight / 2;
            for (let offset = 0; offset < document.documentElement.scrollHeight; offset += step) {
              window.scrollTo(0, offset);
              await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 60)));
            }
            window.scrollTo(0, 0);
            await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 120)));
          });

          const evidence = await collectGapEvidence(page, MIN_GAP_RATIO);
          const label = `qa-010-gaps-${route.name}-${viewport.name}`;

          await testInfo.attach(`${label}.json`, {
            body: Buffer.from(JSON.stringify(evidence, null, 2)),
            contentType: "application/json",
          });

          expect(
            evidence.gaps,
            `${label}: найдены пустые интервалы; neighbours=${JSON.stringify(
              evidence.neighbours,
            )}; gaps=${JSON.stringify(evidence.gaps)}`,
          ).toEqual([]);
        });
      }

      test(`product @ ${viewport.name}`, async ({ page }, testInfo) => {
        // Slug товара зависит от данных, поэтому не зашиваем его: открываем
        // каталог и переходим по первой карточке.
        await page.goto("/catalog");
        await expect(page.locator("[data-card-title]").first()).toBeVisible();
        // Ссылка карточки растянута поверх неё и её accessible name не совпадает
        // с текстом заголовка, поэтому берём href из DOM и переходим напрямую:
        // предмет проверки здесь вёрстка страницы товара, а не сам переход.
        const productHref = await page.evaluate(() => {
          let node: HTMLElement | null = document.querySelector<HTMLElement>("[data-card-title]");
          // Поднимаемся от заголовка, пока предок не окажется карточкой,
          // содержащей растянутую ссылку. Ограничение по глубине не даёт
          // случайно дойти до шапки сайта и взять её ссылку.
          for (let depth = 0; depth < 6 && node; depth += 1) {
            node = node.parentElement;
            const link = node?.querySelector<HTMLAnchorElement>("a[href]");
            if (link) return link.getAttribute("href");
          }
          return null;
        });
        expect(productHref, "не удалось получить ссылку карточки товара").toBeTruthy();
        const productResponse = await page.goto(productHref!);
        expect(productResponse?.status()).toBe(200);

        await page.evaluate(async () => {
          const step = window.innerHeight / 2;
          for (let offset = 0; offset < document.documentElement.scrollHeight; offset += step) {
            window.scrollTo(0, offset);
            await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 60)));
          }
          window.scrollTo(0, 0);
          await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 120)));
        });

        const evidence = await collectGapEvidence(page, MIN_GAP_RATIO);
        const label = `qa-010-gaps-product-${viewport.name}`;
        await testInfo.attach(`${label}.json`, {
          body: Buffer.from(JSON.stringify(evidence, null, 2)),
          contentType: "application/json",
        });

        expect(
          evidence.gaps,
          `${label}: найдены пустые интервалы; url=${page.url()}; neighbours=${JSON.stringify(
            evidence.neighbours,
          )}; gaps=${JSON.stringify(evidence.gaps)}`,
        ).toEqual([]);
      });
    });
  }
});
