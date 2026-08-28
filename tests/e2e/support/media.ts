import { promises as fs } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

export const HERO_VIDEO_PATH_FRAGMENT = "/storage/v1/object/public/site-media/hero/";

/** Ступень hero, к которой относится запрос. */
export type HeroTier = "startup" | "quality";

export function heroTierOf(url: string): HeroTier | null {
  if (!url.includes(HERO_VIDEO_PATH_FRAGMENT)) return null;
  return url.includes("-startup/") ? "startup" : "quality";
}

// Маленький синтетический ролик хранится в Git вместе с тестом. Это делает
// проверку одинаковой в рабочей копии, чистом клоне и CI и не привязывает её
// к локальным результатам `npm run video:hero`, которые исключены из Git.
const STARTUP_FIXTURE_PATH = path.resolve("tests/e2e/fixtures/hero-startup.mp4");

/**
 * Подменяет hero-видео локальными файлами вместо запросов к Storage.
 *
 * Раньше подставлялось пустое тело, и это молча ослабляло проверки: пустой
 * файл не воспроизводится, движение не наступает, и заставка снималась
 * аварийным таймером, а не штатным путём. Тест при этом проходил, но проверял
 * не то, что заявлено. Теперь стартовая ступень всегда получает валидный
 * отслеживаемый Git fixture, и заставка уходит по реальному движению.
 * Качественная ступень остаётся пустой заглушкой: её тяжёлый файл не нужен
 * для этой пробы, а сама подмена проверяется отдельно.
 */
export async function stubLocalHeroVideo(page: Page): Promise<void> {
  let startupFixture: Buffer;
  try {
    startupFixture = await fs.readFile(STARTUP_FIXTURE_PATH);
  } catch (error) {
    throw new Error(`E2E hero fixture отсутствует: ${STARTUP_FIXTURE_PATH}`, { cause: error });
  }

  await page.route(`**${HERO_VIDEO_PATH_FRAGMENT}**`, async (route) => {
    if (heroTierOf(route.request().url()) === "startup") {
      await route.fulfill({ status: 200, contentType: "video/mp4", body: startupFixture });
      return;
    }

    await route.fulfill({ status: 200, contentType: "video/mp4", body: Buffer.alloc(0) });
  });
}
