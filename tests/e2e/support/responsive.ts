import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";

type OverflowEvidence = {
  clientWidth: number;
  scrollWidth: number;
  offenders: Array<{
    tag: string;
    id: string | null;
    className: string;
    left: number;
    right: number;
    width: number;
  }>;
};

export type RequiredControl = {
  name: string;
  locator: Locator;
};

type ControlRect = {
  control: string;
  elementIndex: number;
  label: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export async function assertNoHorizontalOverflow(page: Page, testInfo: TestInfo, label: string) {
  const evidence = await page.evaluate<OverflowEvidence>(() => {
    const clientWidth = document.documentElement.clientWidth;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -0.5 || rect.right > clientWidth + 0.5);
      })
      .slice(0, 20)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || null,
          className: typeof element.className === "string" ? element.className.slice(0, 240) : "",
          left: rect.left,
          right: rect.right,
          width: rect.width,
        };
      });
    return { clientWidth, scrollWidth: document.documentElement.scrollWidth, offenders };
  });

  await testInfo.attach(`${label}-overflow.json`, {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: "application/json",
  });
  expect.soft(
    evidence.scrollWidth,
    `${label}: horizontal overflow; offenders=${JSON.stringify(evidence.offenders)}`,
  ).toBeLessThanOrEqual(evidence.clientWidth);
}

export async function assertCriticalControlsInsideViewport(
  page: Page,
  testInfo: TestInfo,
  label: string,
  controls: readonly RequiredControl[],
) {
  expect(controls.length, `${label}: required controls list не должна быть пустой`).toBeGreaterThan(0);
  const evidence: ControlRect[] = [];
  for (const control of controls) {
    const total = await control.locator.count();
    expect(total, `${label}: required control "${control.name}" отсутствует в DOM`).toBeGreaterThan(0);
    const rects = await control.locator.evaluateAll((elements, controlName) =>
      elements
        .map((element, elementIndex) => {
          const htmlElement = element as HTMLElement;
          const style = getComputedStyle(htmlElement);
          const rect = htmlElement.getBoundingClientRect();
          if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) return null;
          return {
            control: controlName,
            elementIndex,
            label:
              htmlElement.getAttribute("aria-label") ||
              htmlElement.textContent?.trim().slice(0, 80) ||
              htmlElement.tagName,
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          };
        })
        .filter((rect): rect is NonNullable<typeof rect> => rect !== null), control.name);
    expect(rects.length, `${label}: required control "${control.name}" не имеет видимого элемента`).toBeGreaterThan(0);
    evidence.push(...rects);
  }

  const viewport = page.viewportSize();
  if (!viewport) throw new Error(`${label}: Playwright viewport не задан.`);
  const clipped = evidence.filter(
    (control) =>
      control.left < -0.5 ||
      control.top < -0.5 ||
      control.right > viewport.width + 0.5 ||
      control.bottom > viewport.height + 0.5,
  );
  const overlaps: Array<{ first: ControlRect; second: ControlRect }> = [];
  for (let firstIndex = 0; firstIndex < evidence.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < evidence.length; secondIndex += 1) {
      const first = evidence[firstIndex];
      const second = evidence[secondIndex];
      const overlapWidth = Math.min(first.right, second.right) - Math.max(first.left, second.left);
      const overlapHeight = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
      if (overlapWidth > 0.5 && overlapHeight > 0.5) overlaps.push({ first, second });
    }
  }

  await testInfo.attach(`${label}-critical-controls.json`, {
    body: Buffer.from(JSON.stringify({ controls: evidence, clipped, overlaps }, null, 2)),
    contentType: "application/json",
  });
  expect.soft(clipped, `${label}: critical controls clipped`).toEqual([]);
  expect.soft(overlaps, `${label}: critical controls overlap`).toEqual([]);
}
