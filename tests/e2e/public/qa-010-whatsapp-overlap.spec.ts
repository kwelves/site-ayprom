import type { Page } from "@playwright/test";
import { expect, test } from "../support/browser-observer";
import { E2E_VIEWPORTS } from "../support/viewports";

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

/** Один проход прокрутки: все величины сняты в одном кадре, чтобы их можно было сравнивать между собой. */
type ScrollStep = {
  iteration: number;
  scrollY: number;
  innerHeight: number;
  scrollerScrollTop: number;
  scrollerClientHeight: number;
  scrollerScrollHeight: number;
  maxScrollTop: number;
  bodyScrollHeight: number;
  documentElementScrollHeight: number;
  atBottom: boolean;
  heightStable: boolean;
};

type ScrollResult = { settled: boolean; baseline: Omit<ScrollStep, "iteration" | "heightStable">; steps: ScrollStep[] };

type HitCounts = { self: number; badge: number; other: number; void: number };

type CoveredControl = {
  label: string;
  tag: string;
  rect: Rect;
  overlapWidth: number;
  overlapHeight: number;
  coveredRatio: number;
  sampledPoints: number;
  hits: HitCounts;
  /** Первая точка, где верхний hit-target — сам элемент или его потомок. */
  reachableAt: { x: number; y: number } | null;
  /** Кто оказался сверху там, где элемент недостижим, — для читаемого разбора падения. */
  topmostWhenBlocked: string | null;
  verdict: "reachable" | "lost-to-badge" | "blocked-by-other" | "outside-viewport";
};

type OverlapEvidence = {
  badge: { rect: Rect; footprint: Rect; pinnedAtMs: number; animations: number };
  badgeReachable: boolean;
  badgeHits: HitCounts;
  viewport: { innerWidth: number; innerHeight: number };
  interactiveCount: number;
  cardCount: number;
  /** Габариты сетки товаров: по ним видно, доходит ли контент до колонки бейджа. */
  grid: Rect | null;
  badgeOverContent: boolean;
  covered: CoveredControl[];
};

// Прокрутка. Одна и та же scroll box и двигается, и меряется:
// `document.scrollingElement` в standards mode — это само окно, и его
// `scrollTop`/`clientHeight`/`scrollHeight` согласованы между собой. Прежняя
// проба двигала страницу по `document.body.scrollHeight`, а дно проверяла по
// `document.documentElement.scrollHeight`: два разных источника высоты, из-за
// чего условие остановки на узких viewport не выполнялось никогда.
const SCROLL_MAX_ITERATIONS = 25;
const SCROLL_DEADLINE_MS = 15_000;
const SCROLL_SETTLE_MS = 120;
const SCROLL_BOTTOM_TOLERANCE_PX = 1;
// Дно засчитывается только после двух подряд проходов, в которых высота
// документа не изменилась: ленивые изображения и reveal-переходы дорисовывают
// страницу уже после первого прыжка вниз.
const SCROLL_STABLE_ROUNDS = 2;

// Проба достижимости. Сетка точек по видимой площади элемента; отступ от края
// отсекает волосяную полоску, в которую пользователь не попадёт пальцем.
const HIT_SAMPLE_STEPS = 7;
const HIT_EDGE_INSET_PX = 2;
// 0.5 px — тот же порог, что и в support/responsive.ts: гасит субпиксельные
// касания границ и оставляет только реальные наложения.
const OVERLAP_EPSILON_PX = 0.5;

async function settleFrame(page: Page) {
  await page.evaluate(
    (delayMs) =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            window.setTimeout(resolve, delayMs);
          }),
        );
      }),
    SCROLL_SETTLE_MS,
  );
}

function measureScroll(page: Page, scroll: boolean) {
  return page.evaluate(
    ({ tolerance, shouldScroll }) => {
      const scroller = document.scrollingElement ?? document.documentElement;
      // `behavior: "instant"` — чтобы результат не зависел от `scroll-behavior`
      // страницы: при smooth-прокрутке чтение позиции сразу после вызова
      // вернуло бы промежуточный кадр, а не итог.
      if (shouldScroll) scroller.scrollTo({ top: scroller.scrollHeight, left: 0, behavior: "instant" });
      const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
      return {
        scrollY: window.scrollY,
        innerHeight: window.innerHeight,
        scrollerScrollTop: scroller.scrollTop,
        scrollerClientHeight: scroller.clientHeight,
        scrollerScrollHeight: scroller.scrollHeight,
        maxScrollTop,
        bodyScrollHeight: document.body.scrollHeight,
        documentElementScrollHeight: document.documentElement.scrollHeight,
        atBottom: scroller.scrollTop >= maxScrollTop - tolerance,
      };
    },
    { tolerance: SCROLL_BOTTOM_TOLERANCE_PX, shouldScroll: scroll },
  );
}

async function scrollToStableBottom(page: Page): Promise<ScrollResult> {
  // Снимок до первой прокрутки. Именно эту высоту брала прежняя проба как
  // единственную цель прыжка вниз; сравнение с итоговой показывает, насколько
  // страница успевает переверстаться после первого кадра.
  const baseline = await measureScroll(page, false);
  const steps: ScrollStep[] = [];
  const startedAt = Date.now();
  let previousScrollHeight = Number.NaN;
  let stableRounds = 0;

  for (let iteration = 1; iteration <= SCROLL_MAX_ITERATIONS; iteration += 1) {
    const measurement = await measureScroll(page, true);

    const heightStable = measurement.scrollerScrollHeight === previousScrollHeight;
    steps.push({ iteration, ...measurement, heightStable });
    previousScrollHeight = measurement.scrollerScrollHeight;
    stableRounds = measurement.atBottom && heightStable ? stableRounds + 1 : 0;

    if (stableRounds >= SCROLL_STABLE_ROUNDS) return { settled: true, baseline, steps };
    if (Date.now() - startedAt >= SCROLL_DEADLINE_MS) return { settled: false, baseline, steps };
    await settleFrame(page);
  }

  return { settled: false, baseline, steps };
}

/**
 * Ставит карточку правого столбца ровно под бейдж. На самом дне каталога под
 * бейджем оказывается нижний край футера, где интерактивных элементов может не
 * быть вовсе, — тогда проба достижимости не выполнилась бы ни разу и контракт
 * стал бы пустым. Бейдж закреплён, поэтому «под ним» бывает на любом смещении
 * прокрутки, и грид — самое частое из них.
 */
async function scrollCardUnderBadge(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const badge = document.querySelector<HTMLElement>('a[aria-label="Написать в WhatsApp"]');
    const titles = Array.from(document.querySelectorAll<HTMLElement>("[data-card-title]"));
    if (!badge || titles.length === 0) return null;

    const scroller = document.scrollingElement ?? document.documentElement;
    const badgeRect = badge.getBoundingClientRect();
    const rightEdge = Math.max(...titles.map((title) => title.getBoundingClientRect().right));
    const rightColumn = titles.filter((title) => title.getBoundingClientRect().right >= rightEdge - 1);
    const target = rightColumn[Math.floor(rightColumn.length / 2)];
    const targetRect = target.getBoundingClientRect();
    const delta = targetRect.top + targetRect.height / 2 - (badgeRect.top + badgeRect.height / 2);
    scroller.scrollTo({ top: scroller.scrollTop + delta, left: 0, behavior: "instant" });
    return scroller.scrollTop;
  });
}

function describeScrollFailure(label: string, result: ScrollResult): string {
  const last = result.steps.at(-1);
  return [
    `${label}: страница не доведена до низа за ${result.steps.length} проходов (лимит ${SCROLL_MAX_ITERATIONS}, дедлайн ${SCROLL_DEADLINE_MS} мс).`,
    `scrollY=${last?.scrollY}`,
    `innerHeight=${last?.innerHeight}`,
    `body.scrollHeight=${last?.bodyScrollHeight}`,
    `documentElement.scrollHeight=${last?.documentElementScrollHeight}`,
    `maxScrollTop=${last?.maxScrollTop}`,
    `baseline=${JSON.stringify(result.baseline)}`,
    `steps=${JSON.stringify(result.steps)}`,
  ].join("; ");
}

async function collectOverlapEvidence(page: Page) {
  return page.evaluate<OverlapEvidence, { sampleSteps: number; edgeInset: number; overlapEpsilon: number }>(
    ({ sampleSteps, edgeInset, overlapEpsilon }) => {
      const badge = document.querySelector<HTMLElement>('a[aria-label="Написать в WhatsApp"]');
      if (!badge) throw new Error("WhatsApp-бейдж не найден в DOM");

      const toRect = (rect: DOMRect): Rect => ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      });

      // Берём объединение бейджа со всеми его потомками, участвующими в
      // hit-testing. Декоративное pulse-кольцо намеренно исключено через
      // `pointer-events: none`: иначе его прозрачная фаза раздувает невидимую
      // кликабельную область почти вдвое и отнимает нажатия у страницы.
      const footprintOf = (root: HTMLElement): Rect => {
        const base = root.getBoundingClientRect();
        let left = base.left;
        let top = base.top;
        let right = base.right;
        let bottom = base.bottom;
        for (const descendant of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
          const style = getComputedStyle(descendant);
          if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") continue;
          const rect = descendant.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          left = Math.min(left, rect.left);
          top = Math.min(top, rect.top);
          right = Math.max(right, rect.right);
          bottom = Math.max(bottom, rect.bottom);
        }
        return { left, top, right, bottom, width: right - left, height: bottom - top };
      };

      // Участвующие в hit-testing потомки могут быть анимированы, поэтому
      // останавливаем их на фазе максимального footprint: контракт должен
      // держать худший случай, а не удачный кадр.
      const animations = badge.getAnimations({ subtree: true });
      for (const animation of animations) animation.pause();
      const durations = animations
        .map((animation) => animation.effect?.getComputedTiming().duration)
        .filter((duration): duration is number => typeof duration === "number" && Number.isFinite(duration));
      const cycleMs = durations.length > 0 ? Math.max(...durations) : 0;
      let pinnedAtMs = 0;
      if (cycleMs > 0) {
        const PHASES = 24;
        let widestArea = -1;
        for (let phase = 0; phase <= PHASES; phase += 1) {
          const at = (cycleMs * phase) / PHASES;
          for (const animation of animations) animation.currentTime = at;
          const candidate = footprintOf(badge);
          const area = candidate.width * candidate.height;
          if (area > widestArea) {
            widestArea = area;
            pinnedAtMs = at;
          }
        }
        for (const animation of animations) animation.currentTime = pinnedAtMs;
      }

      const badgeRect = toRect(badge.getBoundingClientRect());
      const footprint = footprintOf(badge);

      const classify = (element: HTMLElement, x: number, y: number): keyof HitCounts => {
        const topmost = document.elementsFromPoint(x, y)[0] ?? null;
        if (!topmost) return "void";
        if (topmost === element || element.contains(topmost)) return "self";
        if (topmost === badge || badge.contains(topmost)) return "badge";
        return "other";
      };

      const describeTopmost = (x: number, y: number): string => {
        const topmost = document.elementsFromPoint(x, y)[0] as HTMLElement | undefined;
        if (!topmost) return "none";
        const label = topmost.getAttribute("aria-label");
        const id = topmost.id ? `#${topmost.id}` : "";
        const cls =
          topmost.classList.length > 0 ? `.${Array.from(topmost.classList).slice(0, 2).join(".")}` : "";
        return `${topmost.tagName.toLowerCase()}${id}${cls}${label ? `[${label}]` : ""}`;
      };

      const samplePoints = (rect: Rect): { x: number; y: number }[] => {
        const insetX = Math.min(edgeInset, rect.width / 4);
        const insetY = Math.min(edgeInset, rect.height / 4);
        const left = Math.max(0, rect.left + insetX);
        const right = Math.min(window.innerWidth - 1, rect.right - insetX);
        const top = Math.max(0, rect.top + insetY);
        const bottom = Math.min(window.innerHeight - 1, rect.bottom - insetY);
        if (right < left || bottom < top) return [];
        const axis = (from: number, to: number) =>
          to - from < 1
            ? [(from + to) / 2]
            : Array.from(
                { length: sampleSteps },
                (_, index) => from + ((to - from) * index) / (sampleSteps - 1),
              );
        const xs = axis(left, right);
        const ys = axis(top, bottom);
        return xs.flatMap((x) => ys.map((y) => ({ x, y })));
      };

      // Считаем весь документ, а не только <main>: в самом низу страницы под
      // бейджем оказывается футер, который лежит вне <main>.
      const interactive = Array.from(
        document.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
      ).filter((element) => {
        if (element === badge || badge.contains(element)) return false;
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (style.pointerEvents === "none") return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      const covered: CoveredControl[] = [];
      for (const element of interactive) {
        const rect = toRect(element.getBoundingClientRect());
        const overlapWidth = Math.min(footprint.right, rect.right) - Math.max(footprint.left, rect.left);
        const overlapHeight = Math.min(footprint.bottom, rect.bottom) - Math.max(footprint.top, rect.top);
        if (overlapWidth <= overlapEpsilon || overlapHeight <= overlapEpsilon) continue;

        const points = samplePoints(rect);
        const hits: HitCounts = { self: 0, badge: 0, other: 0, void: 0 };
        let reachableAt: { x: number; y: number } | null = null;
        let topmostWhenBlocked: string | null = null;
        for (const point of points) {
          const outcome = classify(element, point.x, point.y);
          hits[outcome] += 1;
          if (outcome === "self") {
            if (!reachableAt) reachableAt = { x: Math.round(point.x), y: Math.round(point.y) };
          } else if (!topmostWhenBlocked) {
            topmostWhenBlocked = describeTopmost(point.x, point.y);
          }
        }

        const area = rect.width * rect.height;
        const verdict: CoveredControl["verdict"] =
          points.length === 0
            ? "outside-viewport"
            : hits.self > 0
              ? "reachable"
              : hits.badge > 0
                ? "lost-to-badge"
                : "blocked-by-other";

        covered.push({
          label:
            element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 80) || element.tagName,
          tag: element.tagName.toLowerCase(),
          rect,
          overlapWidth,
          overlapHeight,
          // Доля перекрытой площади остаётся в отчёте как справка о масштабе
          // наложения. Вердикт она больше не выносит: площадь не знает ни про
          // z-index, ни про pointer-events.
          coveredRatio: area > 0 ? Number(((overlapWidth * overlapHeight) / area).toFixed(3)) : 1,
          sampledPoints: points.length,
          hits,
          reachableAt,
          topmostWhenBlocked,
          verdict,
        });
      }

      // Сам бейдж тоже обязан оставаться нажимаемым: контракт запрещает не
      // только отнимать чужие клики, но и терять собственный.
      const badgeHits: HitCounts = { self: 0, badge: 0, other: 0, void: 0 };
      for (const point of samplePoints(badgeRect)) {
        const topmost = document.elementsFromPoint(point.x, point.y)[0] ?? null;
        if (!topmost) badgeHits.void += 1;
        else if (topmost === badge || badge.contains(topmost)) badgeHits.self += 1;
        else badgeHits.other += 1;
      }

      // Сетка товаров ограничена по ширине контейнером, а бейдж прижат к краю
      // окна. На широких экранах он оказывается в пустом поле сбоку от
      // контента — тогда под ним физически нечему быть, и это не «проба
      // прошла вхолостую», а измеренный факт.
      const cardRects = Array.from(document.querySelectorAll<HTMLElement>("[data-card-title]")).map(
        (card) => card.getBoundingClientRect(),
      );
      const grid: Rect | null =
        cardRects.length === 0
          ? null
          : (() => {
              const left = Math.min(...cardRects.map((rect) => rect.left));
              const right = Math.max(...cardRects.map((rect) => rect.right));
              const top = Math.min(...cardRects.map((rect) => rect.top));
              const bottom = Math.max(...cardRects.map((rect) => rect.bottom));
              return { left, top, right, bottom, width: right - left, height: bottom - top };
            })();

      return {
        badge: { rect: badgeRect, footprint, pinnedAtMs, animations: animations.length },
        badgeReachable: badgeHits.self > 0,
        badgeHits,
        viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
        interactiveCount: interactive.length,
        cardCount: cardRects.length,
        grid,
        badgeOverContent: grid !== null && footprint.left < grid.right && footprint.right > grid.left,
        covered,
      };
    },
    { sampleSteps: HIT_SAMPLE_STEPS, edgeInset: HIT_EDGE_INSET_PX, overlapEpsilon: OVERLAP_EPSILON_PX },
  );
}

/**
 * QA-010: закреплённый WhatsApp-бейдж лежит поверх контента с `z-[60]`, и на
 * узких экранах сетка каталога доходит до самого низа страницы — нижняя правая
 * карточка и футер оказываются прямо под ним.
 *
 * Контракт говорит ровно одно: **пересечение допустимо, потеря достижимости —
 * нет**. Закреплённая кнопка по своей природе лежит поверх страницы, и требовать
 * нулевого пересечения значило бы требовать убрать саму кнопку. Значение имеет
 * другое: остаётся ли у перекрытого control хотя бы одна точка, куда
 * пользователь реально может нажать. Это и проверяется — через
 * `document.elementsFromPoint()`, а не через долю закрытой площади: площадь не
 * знает ни про z-index, ни про pointer-events и доказательством
 * недостижимости не является.
 *
 * Бейдж закреплён, поэтому «под ним» бывает на любом смещении прокрутки.
 * Замер снимается на двух: на дне страницы (там футер) и на гриде (там
 * карточка товара) — иначе на дне под бейджем может не оказаться ни одного
 * control и контракт проходил бы вхолостую.
 */
test.describe("[QA-010] WhatsApp-бейдж пересекает controls каталога, но не отнимает у них достижимость", () => {
  for (const viewport of E2E_VIEWPORTS) {
    test.describe(viewport.name, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test(`каталог, низ страницы @ ${viewport.name}`, async ({ page }, testInfo) => {
        const response = await page.goto("/catalog");
        expect(response?.status()).toBe(200);
        const badge = page.getByRole("link", { name: "Написать в WhatsApp" });
        await expect(badge).toBeVisible();
        await expect(badge.locator("[data-whatsapp-pulse]")).toHaveCSS("pointer-events", "none");

        // Дефект проявляется в конце сетки: пока страница не прокручена, под
        // бейджем пусто.
        const scroll = await scrollToStableBottom(page);
        const label = `qa-010-whatsapp-${viewport.name}`;
        await testInfo.attach(`${label}-scroll.json`, {
          body: Buffer.from(JSON.stringify(scroll, null, 2)),
          contentType: "application/json",
        });
        expect(scroll.settled, describeScrollFailure(label, scroll)).toBe(true);

        // Замер снимается на двух положениях прокрутки: на самом дне (там под
        // бейджем футер) и на гриде (там под бейджем карточка товара).
        const positions: { name: string; evidence: OverlapEvidence }[] = [
          { name: "bottom", evidence: await collectOverlapEvidence(page) },
        ];
        await scrollCardUnderBadge(page);
        await settleFrame(page);
        positions.push({ name: "grid", evidence: await collectOverlapEvidence(page) });

        for (const position of positions) {
          await testInfo.attach(`${label}-${position.name}.json`, {
            body: Buffer.from(JSON.stringify(position.evidence, null, 2)),
            contentType: "application/json",
          });
        }
        await testInfo.attach(`${label}.png`, {
          body: await page.screenshot({ animations: "disabled" }),
          contentType: "image/png",
        });

        for (const { name, evidence } of positions) {
          const at = `${label}/${name}`;
          expect(
            evidence.interactiveCount,
            `${at}: на странице не нашлось интерактивных элементов — проверка вырождается`,
          ).toBeGreaterThan(0);

          // Отдельно: сам бейдж обязан оставаться нажимаемым.
          expect(
            evidence.badgeReachable,
            `${at}: сам WhatsApp-бейдж перестал быть нажимаемым; badge=${JSON.stringify(
              evidence.badge,
            )}; hits=${JSON.stringify(evidence.badgeHits)}`,
          ).toBe(true);

          // Список идёт прямо в сообщение, как offenders в support/responsive.ts:
          // по одному падению должно быть видно, какой именно control потерял
          // клик и что оказалось поверх него, без раскрытия trace.
          const lostToBadge = evidence.covered.filter((candidate) => candidate.verdict === "lost-to-badge");
          expect(
            lostToBadge,
            `${at}: WhatsApp-бейдж отнял достижимость у controls; badge=${JSON.stringify(
              evidence.badge,
            )}; covered=${JSON.stringify(evidence.covered)}`,
          ).toEqual([]);
        }

        // Контракт не должен проходить «потому что мерить было нечего». Одно из
        // двух обязано быть верным: либо под бейджем нашёлся реальный control и
        // его достижимость проверена, либо измерено, что сетка каталога вообще
        // не доходит до колонки бейджа (широкие экраны: контейнер ограничен по
        // ширине, бейдж прижат к краю окна). Проверка безусловная — условного
        // пропуска здесь быть не должно.
        const probeMeaningful =
          positions.some((position) => position.evidence.covered.length > 0) ||
          positions.every((position) => !position.evidence.badgeOverContent);
        expect(
          probeMeaningful,
          `${label}: под бейджем не оказалось ни одного control, хотя сетка доходит до его колонки — проба достижимости вырождается; positions=${JSON.stringify(
            positions.map((position) => ({
              name: position.name,
              badge: position.evidence.badge,
              grid: position.evidence.grid,
              badgeOverContent: position.evidence.badgeOverContent,
              covered: position.evidence.covered.length,
            })),
          )}`,
        ).toBe(true);
      });
    });
  }
});
