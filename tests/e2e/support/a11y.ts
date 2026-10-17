import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

// Screens fade and slide in. Axe reads the colour a person sees, so a check made halfway through an entrance sees
// half-transparent text and reports a contrast that no visitor ever has. Wait until every running animation has
// ended (infinite ones, such as a status ring, are not waited for).
async function waitForEntranceAnimations(page: Page) {
  // A list may be redrawn right after it appears (the drag-and-drop layer mounts a moment later) and then starts its
  // entrance again, so one wait is not enough: stop only after the page stayed free of running animations twice in a row.
  await page.evaluate(async () => {
    const running = () =>
      document.getAnimations().filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime ?? 0) && animation.playState !== "finished");
    let calm = 0;
    for (let attempt = 0; attempt < 40 && calm < 2; attempt += 1) {
      const pending = running();
      if (pending.length === 0) {
        calm += 1;
        await new Promise((resolve) => setTimeout(resolve, 120));
      } else {
        calm = 0;
        await Promise.allSettled(pending.map((animation) => animation.finished));
      }
    }
  });
}

export async function expectNoSeriousOrCriticalA11yViolations(page: Page, testInfo: TestInfo) {
  await waitForEntranceAnimations(page);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = result.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );

  await testInfo.attach("axe-serious-critical.json", {
    body: Buffer.from(JSON.stringify(blocking, null, 2)),
    contentType: "application/json",
  });

  expect(blocking, "Axe не должен находить serious/critical нарушения").toEqual([]);
}
