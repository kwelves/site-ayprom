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

// Только лёгкая ступень. Тяжёлая весит 22–25 МБ, и прогонять её через
// перехват на каждой навигации — это секунды на пустом месте и оборванные
// запросы при переходе на следующую страницу. Для тестов достаточно, чтобы
// играла стартовая: подмена ступеней проверяется отдельно, вне браузера.
const LOCAL_FILES: Record<string, string> = {
  "hero-startup-desktop.mp4": "hero-desktop-startup.mp4",
  "hero-startup-mobile.mp4": "hero-mobile-startup.mp4",
};

/**
 * Подменяет hero-видео локальными файлами вместо запросов к Storage.
 *
 * Раньше подставлялось пустое тело, и это молча ослабляло проверки: пустой
 * файл не воспроизводится, движение не наступает, и заставка снималась
 * аварийным таймером, а не штатным путём. Тест при этом проходил, но проверял
 * не то, что заявлено. Теперь отдаются настоящие файлы, если они собраны
 * локально (`npm run video:hero`), и заставка уходит по реальному движению.
 *
 * Файлы лежат вне git (`/public/videos/hero-web/`), поэтому там, где их нет,
 * поведение прежнее — пустое тело и аварийный таймер.
 */
export async function stubLocalHeroVideo(page: Page): Promise<void> {
  const directory = path.resolve("public/videos/hero-web");

  await page.route(`**${HERO_VIDEO_PATH_FRAGMENT}**`, async (route) => {
    const remoteName = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    const localName = LOCAL_FILES[remoteName];

    if (localName) {
      try {
        const body = await fs.readFile(path.join(directory, localName));
        await route.fulfill({ status: 200, contentType: "video/mp4", body });
        return;
      } catch {
        // Файла нет — падать нельзя: он не хранится в репозитории.
      }
    }

    await route.fulfill({ status: 200, contentType: "video/mp4", body: Buffer.alloc(0) });
  });
}
