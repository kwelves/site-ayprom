import type { Page } from "@playwright/test";

export const HERO_VIDEO_PATH_FRAGMENT = "/storage/v1/object/public/site-media/hero/";

export async function stubLocalHeroVideo(page: Page): Promise<void> {
  await page.route(`**${HERO_VIDEO_PATH_FRAGMENT}**`, async (route) => {
    await route.fulfill({ status: 200, contentType: "video/mp4", body: Buffer.alloc(0) });
  });
}
