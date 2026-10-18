import type { Locator } from "@playwright/test";
import { expect } from "./browser-observer";

/**
 * Waits until React has attached its change handler to a form control.
 *
 * Choosing a file with `setInputFiles` right after `page.goto` raced the page becoming interactive: on a busy CI
 * runner the `change` event could fire before React had wired `onChange`, nobody heard it, and the photo upload
 * simply never started ("Фото пока нет" in the failure snapshot). React keeps the props of a rendered element in a
 * `__reactProps$…` key on the DOM node, so the handler being there is an exact signal, not a guess about timing.
 */
export async function waitForReactChangeHandler(control: Locator, timeout = 30_000): Promise<void> {
  await expect
    .poll(
      () =>
        control.evaluate((element) => {
          const key = Object.keys(element).find((name) => name.startsWith("__reactProps$"));
          const props = key ? (element as unknown as Record<string, { onChange?: unknown } | undefined>)[key] : undefined;
          return typeof props?.onChange === "function";
        }),
      { timeout },
    )
    .toBe(true);
}
