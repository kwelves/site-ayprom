/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminToastProvider } from "@/components/admin/ui/AdminToastProvider";
import { useSaveFlowFlash } from "@/lib/admin/use-save-flow-flash";

const navigation = vi.hoisted(() => ({
  pathname: "/admin/products",
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => navigation.searchParams,
}));

function FlashHarness() {
  const { highlightedKey } = useSaveFlowFlash({
    flashKey: "saved-product",
    flashAction: "updated",
    messages: { created: "Создан", updated: "Обновлён" },
    warningMessage: "Две фотографии не загружены.",
  });
  return <div data-flash-key="saved-product" data-highlighted={highlightedKey === "saved-product"} />;
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  navigation.replace.mockReset();
  navigation.searchParams = new URLSearchParams(
    "page=2&sort=updated&view=target&relaxed=category&updated=saved-product&photoError=2",
  );
  scrollIntoView.mockReset();
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 20,
    bottom: 60,
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useSaveFlowFlash", () => {
  it("removes only one-shot params, keeps the target view, and does not scroll a visible row", async () => {
    render(
      <AdminToastProvider>
        <FlashHarness />
      </AdminToastProvider>,
    );

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Обновлён"));
    expect(screen.getByRole("status").textContent).toContain("Две фотографии не загружены");
    expect(navigation.replace).toHaveBeenCalledWith(
      "/admin/products?page=2&sort=updated&view=target&relaxed=category",
      { scroll: false },
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(document.querySelector('[data-flash-key="saved-product"]')?.getAttribute("data-highlighted")).toBe("true"),
    );
  });
});
