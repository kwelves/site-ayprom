import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

export async function expectNoSeriousOrCriticalA11yViolations(page: Page, testInfo: TestInfo) {
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
