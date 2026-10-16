import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

// Screens fade and slide in. Axe reads the colour a person sees, so a check made halfway through an entrance sees
// half-transparent text and reports a contrast that no visitor ever has. Wait until every running animation has
// ended (infinite ones, such as a status ring, are not waited for).
async function waitForEntranceAnimations(page: Page) {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime ?? 0));
    await Promise.allSettled(finite.map((animation) => animation.finished));
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
