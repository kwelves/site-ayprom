/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackButton } from "@/components/ui/BackButton";

const router = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

function setNavigation(canGoBack?: boolean) {
  if (canGoBack === undefined) {
    delete (window as Window & { navigation?: unknown }).navigation;
    return;
  }
  Object.defineProperty(window, "navigation", {
    configurable: true,
    value: { canGoBack },
  });
}

beforeEach(() => {
  router.back.mockReset();
  router.replace.mockReset();
  window.history.replaceState(null, "", "/catalog/category/pto");
});

afterEach(() => {
  cleanup();
  setNavigation(undefined);
});

describe("BackButton", () => {
  it("использует native back при безопасной внутренней истории", () => {
    setNavigation(true);
    render(<BackButton />);

    fireEvent.click(screen.getByRole("button", { name: "Назад" }));

    expect(router.back).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("заменяет прямой вход на fallback каталога", () => {
    setNavigation(false);
    render(<BackButton />);

    fireEvent.click(screen.getByRole("button", { name: "Назад" }));

    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/catalog");
  });

  it("поддерживает явный fallback для корня каталога", () => {
    setNavigation(undefined);
    render(<BackButton fallbackHref="/" />);

    fireEvent.click(screen.getByRole("button", { name: "Назад" }));

    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/");
  });
});
