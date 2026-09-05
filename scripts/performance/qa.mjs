/**
 * Реальная браузерная проверка публичной главной на изолированном Chromium.
 *
 * Только чтение: скрипт открывает локальный production-сервер, наблюдает
 * заставку, сеть, консоль и раскладку и складывает доказательства в JSON и
 * скриншоты. Ничего не пишет ни в базу, ни на сервер.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const url = option("--url", "http://127.0.0.1:3115");
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) {
  throw new Error("QA runner only accepts an isolated loopback server.");
}
const output = path.resolve(option("--output", ".tmp-pagespeed/qa"));
mkdirSync(output, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const HERO_STARTUP = "hero/2026-08-27-startup";
const HERO_QUALITY = "hero/2026-08-18-2k";
const SHOWCASE_CHUNK = /_next\/static\/chunks\/.*\.js$/;

/**
 * Отметка о снятии заставки. Ставится в самой странице до её скриптов, чтобы
 * время считалось от начала загрузки документа, а не от момента, когда до
 * страницы дошёл тест.
 */
const BOOT_PROBE = `(() => {
  window.__bootProbe = { appeared: null, cleared: null, everLocked: false };
  const overlaySelector = '[role="progressbar"][aria-label="Загрузка сайта"]';
  const contentSelector = '[data-home-entry-content]';
  const check = () => {
    const overlay = document.querySelector(overlaySelector);
    const content = document.querySelector(contentSelector);
    const locked = Boolean(overlay) || Boolean(content && content.hasAttribute('inert'));
    if (locked) {
      window.__bootProbe.everLocked = true;
      if (window.__bootProbe.appeared === null) window.__bootProbe.appeared = performance.now();
      window.__bootProbe.cleared = null;
      return;
    }
    if (window.__bootProbe.everLocked && window.__bootProbe.cleared === null) {
      window.__bootProbe.cleared = performance.now();
    }
  };
  const observer = new MutationObserver(check);
  const start = () => {
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
    check();
  };
  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });
  window.__layoutShifts = [];
  const describe = (node) => {
    if (!node || !node.tagName) return null;
    const id = node.id ? '#' + node.id : '';
    const cls = typeof node.className === 'string' ? '.' + node.className.trim().split(/\\s+/).slice(0, 3).join('.') : '';
    return node.tagName.toLowerCase() + id + cls;
  };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.hadRecentInput) continue;
      window.__layoutShifts.push({
        value: entry.value,
        time: entry.startTime,
        sources: (entry.sources ?? []).map((source) => describe(source.node)),
      });
    }
  }).observe({ type: 'layout-shift', buffered: true });
})();`;

function watchPage(page) {
  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const failedRequests = [];
  const requests = [];

  page.on("console", (message) => {
    const record = { type: message.type(), text: message.text() };
    if (message.type() === "error") consoleErrors.push(record);
    if (message.type() === "warning") consoleWarnings.push(record);
  });
  page.on("pageerror", (error) => pageErrors.push(String(error.message)));
  page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), failure: request.failure()?.errorText }));
  page.on("request", (request) => requests.push({ phase: "start", url: request.url(), at: Date.now() }));
  page.on("requestfinished", (request) => requests.push({ phase: "finish", url: request.url(), at: Date.now() }));

  return { consoleErrors, consoleWarnings, pageErrors, failedRequests, requests };
}

const firstAt = (requests, phase, match) => requests.find((entry) => entry.phase === phase && entry.url.includes(match))?.at ?? null;

/**
 * Исполненные байты скриптов. Диапазоны покрытия вложены друг в друга
 * (внешняя функция содержит внутренние), поэтому простая сумма длин считает
 * одни и те же байты по нескольку раз — интервалы нужно объединять.
 */
function executedBytes(scripts) {
  let executed = 0;
  for (const script of scripts) {
    const ranges = script.functions
      .flatMap((fn) => fn.ranges.filter((range) => range.count > 0))
      .sort((a, b) => a.startOffset - b.startOffset);
    let cursor = -1;
    for (const range of ranges) {
      const start = Math.max(range.startOffset, cursor);
      if (range.endOffset > start) {
        executed += range.endOffset - start;
        cursor = range.endOffset;
      }
    }
  }
  return executed;
}

/** Переданные по сети байты JavaScript по данным Resource Timing. */
async function transferredJs(page) {
  return page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => entry.initiatorType === "script" || entry.name.includes("/_next/static/chunks/"))
      .reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
  );
}

async function readBootProbe(page) {
  return page.evaluate(() => ({ ...window.__bootProbe }));
}

async function layoutSummary(page) {
  return page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    cumulativeLayoutShift: (window.__layoutShifts ?? []).reduce((sum, shift) => sum + shift.value, 0),
    shifts: window.__layoutShifts ?? [],
  }));
}

async function newContext(browser, viewport, options = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    isMobile: viewport === "mobile",
    hasTouch: viewport === "mobile",
    reducedMotion: options.reducedMotion ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  await page.addInitScript(BOOT_PROBE);
  return { context, page };
}

const report = {};

const browser = await chromium.launch();
try {
  // ── Сценарий 1: обычная загрузка на обеих ширинах ────────────────────────
  for (const viewport of ["desktop", "mobile"]) {
    const { context, page } = await newContext(browser, viewport);
    const watched = watchPage(page);
    await page.coverage.startJSCoverage({ resetOnNavigation: false });

    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(2_500);

    const boot = await readBootProbe(page);
    const beforeScroll = await page.evaluate(() => ({
      showcaseCarouselImages: document.querySelectorAll('#vehicle-showcase img[src*="_next/image"]').length,
      shellImages: document.querySelectorAll("#vehicle-showcase img[data-vehicle-shell-image]").length,
      shellLinks: [...document.querySelectorAll('#vehicle-showcase a[href^="/catalog/vehicle-type/"]')].map((link) => link.getAttribute("href")),
      headerNavNames: [...document.querySelectorAll("header a, header button")].map((el) => el.textContent?.trim()).filter(Boolean).slice(0, 12),
      h1: document.querySelector("h1")?.textContent?.trim(),
    }));

    const chunksBeforeScroll = watched.requests.filter((entry) => entry.phase === "start" && SHOWCASE_CHUNK.test(entry.url)).length;
    // Покрытие снимается ДО прокрутки: нужен именно первоначальный экран, без
    // чанка витрины и без всего, что подтянут дальнейшие действия.
    const initialCoverage = (await page.coverage.stopJSCoverage()).filter((entry) => entry.url.startsWith(url));
    const initialJs = {
      scripts: initialCoverage.length,
      transferredBytes: await transferredJs(page),
      deliveredBytes: initialCoverage.reduce((sum, entry) => sum + (entry.source?.length ?? 0), 0),
      executedBytes: executedBytes(initialCoverage),
    };
    // Доля «исполненных» байт по V8-покрытию здесь не показательна: у каждого
    // выполненного модуля верхний диапазон помечен исполненным целиком.
    // Реально неиспользуемую часть меряет аудит Lighthouse unused-javascript.
    await page.screenshot({ path: path.join(output, `after-${viewport}-top.png`) });

    // Подойти к витрине и дождаться интерактива.
    await page.evaluate(() => document.getElementById("vehicle-showcase")?.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(2_500);
    const chunksAfterScroll = watched.requests.filter((entry) => entry.phase === "start" && SHOWCASE_CHUNK.test(entry.url)).length;

    const afterScroll = await page.evaluate(() => ({
      hotspots: document.querySelectorAll('#vehicle-showcase button[aria-pressed]').length,
      carouselButtons: document.querySelectorAll('#vehicle-showcase [aria-current]').length,
      shellImages: document.querySelectorAll("#vehicle-showcase img[data-vehicle-shell-image]").length,
    }));

    // Хотспот → карточка товара.
    let productPanel = null;
    const hotspot = page.locator("#vehicle-showcase button[aria-pressed]:visible").first();
    if (await hotspot.count()) {
      await hotspot.click();
      await page.waitForTimeout(1_500);
      productPanel = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="product-panel"]');
        return panel ? { visible: panel.getBoundingClientRect().height > 0, text: panel.textContent?.slice(0, 60) } : null;
      });
    }
    await page.screenshot({ path: path.join(output, `after-${viewport}-showcase.png`) });

    // Переключение техники каруселью. Соседние слоты ленты уезжают за края
    // маски, поэтому кликается тот, чей центр реально попадает в окно.
    let vehicleSwitched = null;
    try {
      const candidates = page.locator('#vehicle-showcase [aria-current="false"]');
      const total = await candidates.count();
      let target = null;
      for (let index = 0; index < total; index++) {
        const box = await candidates.nth(index).boundingBox();
        if (!box) continue;
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        if (centerX > 0 && centerX < VIEWPORTS[viewport].width && centerY > 0 && centerY < VIEWPORTS[viewport].height) {
          target = candidates.nth(index);
          break;
        }
      }
      if (target) {
        const before = await page.evaluate(() => document.querySelector("#vehicle-showcase p")?.textContent);
        await target.click({ timeout: 5_000 });
        await page.waitForTimeout(2_500);
        const after = await page.evaluate(() => document.querySelector("#vehicle-showcase p")?.textContent);
        vehicleSwitched = { before, after, changed: before !== after };
      }
    } catch (error) {
      vehicleSwitched = { error: String(error).slice(0, 120) };
    }

    // Наведение на карточку каталога: одна переезжающая рамка.
    await page.evaluate(() => document.querySelector("[data-hover-border-grid]")?.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(1_000);
    let hoverBorder = null;
    const cards = page.locator("[data-hover-border-grid] [data-hover-border-item]:visible");
    if ((await cards.count()) > 1) {
      try {
      await cards.nth(0).hover({ timeout: 8_000 });
      await page.waitForTimeout(300);
      const first = await page.evaluate(() => {
        const highlight = document.querySelector("[data-hover-border-highlight]");
        return highlight ? highlight.getBoundingClientRect().toJSON() : null;
      });
      await cards.nth(1).hover({ timeout: 8_000 });
      await page.waitForTimeout(700);
      const second = await page.evaluate(() => {
        const nodes = document.querySelectorAll("[data-hover-border-highlight]");
        const highlight = nodes[0];
        return { count: nodes.length, rect: highlight ? highlight.getBoundingClientRect().toJSON() : null };
      });
      const cardRect = await cards.nth(1).boundingBox();
      hoverBorder = {
        count: second.count,
        moved: Boolean(first && second.rect && Math.abs(first.x - second.rect.x) > 1),
        alignmentError: second.rect && cardRect ? Math.abs(second.rect.x + second.rect.width / 2 - (cardRect.x + cardRect.width / 2)) : null,
      };
      } catch (error) {
        hoverBorder = { error: String(error).slice(0, 160) };
      }
    }

    // Выпадающее меню: мышь и клавиатура. Прокрутка мгновенная — плавная не
    // успевает закончиться, и курсор попадает по карточке каталога.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(1_200);
    let dropdown = null;
    // На узкой ширине шапка сворачивается в бургер, и выпадающего меню там нет.
    const trigger = page.locator("header a[aria-controls][aria-expanded]:visible").first();
    if (await trigger.count()) {
      try {
      const panelId = await trigger.getAttribute("aria-controls");
      const readPanel = () => page.evaluate((id) => {
        const panel = document.getElementById(id);
        return panel ? { inert: panel.hasAttribute("inert"), ariaHidden: panel.getAttribute("aria-hidden"), opacity: getComputedStyle(panel).opacity, links: panel.querySelectorAll("a").length } : null;
      }, panelId);
      const closed = await readPanel();
      await trigger.hover({ timeout: 8_000 });
      await page.waitForTimeout(400);
      const hovered = await readPanel();
      await page.mouse.move(5, 400);
      await page.waitForTimeout(400);
      await trigger.focus();
      await page.waitForTimeout(300);
      const focused = await readPanel();
      const expandedOnFocus = await trigger.getAttribute("aria-expanded");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      const escaped = await readPanel();
      const expandedAfterEscape = await trigger.getAttribute("aria-expanded");
      dropdown = { closed, hovered, focused, expandedOnFocus, escaped, expandedAfterEscape };
      } catch (error) {
        dropdown = { error: String(error).slice(0, 160) };
      }
    }

    const startupFinished = firstAt(watched.requests, "finish", HERO_STARTUP);
    const qualityStarted = firstAt(watched.requests, "start", HERO_QUALITY);

    report[`load-${viewport}`] = {
      boot: {
        ...boot,
        // Дедлайн отсчитывается от старта boot-последовательности, то есть от
        // момента, когда заставка появилась на экране (до гидратации её в
        // разметке нет вовсе). `cleared`/`appeared` — от начала загрузки
        // документа, поэтому здесь их разность.
        visibleMs: boot.cleared !== null && boot.appeared !== null ? boot.cleared - boot.appeared : null,
        withinDeadline: boot.cleared !== null && boot.appeared !== null && boot.cleared - boot.appeared <= 1500,
      },
      beforeScroll: { ...beforeScroll, showcaseChunkRequests: chunksBeforeScroll },
      afterScroll: { ...afterScroll, showcaseChunkRequests: chunksAfterScroll },
      productPanel,
      vehicleSwitched,
      hoverBorder,
      dropdown,
      layout: await layoutSummary(page),
      heroVideo: {
        startupFinishedAt: startupFinished,
        qualityStartedAt: qualityStarted,
        qualityAfterStartupBuffered: startupFinished !== null && qualityStarted !== null ? qualityStarted >= startupFinished : null,
      },
      initialJs,
      totalTransferredJsAfterInteractions: await transferredJs(page),
      console: {
        errors: watched.consoleErrors,
        warnings: watched.consoleWarnings,
        pageErrors: watched.pageErrors,
        hydrationErrors: [...watched.consoleErrors, ...watched.pageErrors.map((text) => ({ text }))].filter((entry) => /418|[Hh]ydrat/.test(entry.text)),
      },
      failedRequests: watched.failedRequests,
    };

    await context.close();
  }

  // ── Сценарий 2: reduced motion ──────────────────────────────────────────
  {
    const { context, page } = await newContext(browser, "desktop", { reducedMotion: true });
    const watched = watchPage(page);
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: path.join(output, "after-reduced-motion.png") });
    report["reduced-motion"] = {
      boot: await readBootProbe(page),
      layout: await layoutSummary(page),
      console: { errors: watched.consoleErrors, warnings: watched.consoleWarnings, pageErrors: watched.pageErrors },
    };
    await context.close();
  }

  // ── Сценарий 3: hero-видео недоступно ───────────────────────────────────
  {
    const { context, page } = await newContext(browser, "desktop");
    const watched = watchPage(page);
    await page.route("**/site-media/hero/**", (route) => route.abort());
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(2_500);
    const navUsable = await page.evaluate(() => {
      const content = document.querySelector("[data-home-entry-content]");
      const link = document.querySelector('header a[href="/catalog"]');
      return {
        contentInert: Boolean(content?.hasAttribute("inert")),
        catalogLinkVisible: Boolean(link && link.getBoundingClientRect().height > 0),
      };
    });
    await page.screenshot({ path: path.join(output, "after-broken-video.png") });
    report["broken-hero-video"] = {
      boot: await readBootProbe(page),
      navUsable,
      layout: await layoutSummary(page),
      console: { errors: watched.consoleErrors, warnings: watched.consoleWarnings, pageErrors: watched.pageErrors },
    };
    await context.close();
  }

  // ── Сценарий 4: медленная загрузка чанка витрины ────────────────────────
  {
    const { context, page } = await newContext(browser, "desktop");
    const watched = watchPage(page);
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(2_000);
    // Задержать любые чанки, которые запросят ПОСЛЕ первой загрузки.
    await page.route(SHOWCASE_CHUNK, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await route.continue();
    });
    const before = await page.evaluate(() => {
      const section = document.getElementById("vehicle-showcase");
      return { height: section?.getBoundingClientRect().height ?? null, shell: document.querySelectorAll("#vehicle-showcase img[data-vehicle-shell-image]").length };
    });
    await page.evaluate(() => document.getElementById("vehicle-showcase")?.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(800);
    const during = await page.evaluate(() => {
      const section = document.getElementById("vehicle-showcase");
      return {
        height: section?.getBoundingClientRect().height ?? null,
        shell: document.querySelectorAll("#vehicle-showcase img[data-vehicle-shell-image]").length,
        links: document.querySelectorAll('#vehicle-showcase a[href^="/catalog/vehicle-type/"]').length,
      };
    });
    await page.screenshot({ path: path.join(output, "after-slow-chunk.png") });
    await page.waitForTimeout(4_000);
    const settled = await page.evaluate(() => {
      const section = document.getElementById("vehicle-showcase");
      return { height: section?.getBoundingClientRect().height ?? null, hotspots: document.querySelectorAll('#vehicle-showcase button[aria-pressed]').length };
    });
    report["slow-showcase-chunk"] = {
      before,
      during,
      settled,
      sectionHeightStable: before.height !== null && during.height !== null && settled.height !== null && Math.abs(before.height - settled.height) < 1,
      layout: await layoutSummary(page),
      console: { errors: watched.consoleErrors, warnings: watched.consoleWarnings, pageErrors: watched.pageErrors },
    };
    await context.close();
  }
} finally {
  await browser.close();
}

writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
