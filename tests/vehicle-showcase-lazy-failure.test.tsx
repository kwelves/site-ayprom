// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VehicleShowcaseLazy } from "@/components/home/vehicle-showcase/VehicleShowcaseLazy";
import type { VehicleVisual } from "@/components/home/vehicle-showcase/vehicle-visual";
import type { VehicleShowcaseEntry } from "@/lib/queries/vehicle-hotspots";

// Имитация несостоявшейся загрузки чанка: import() отклоняется.
vi.mock("@/components/home/vehicle-showcase/VehicleShowcaseInteractive", () => {
  throw new Error("ChunkLoadError: Loading chunk failed");
});

const entries = [
  { vehicleType: { slug: "kran-manipulyator", name: "Кран-манипулятор" }, hotspots: [] },
] as unknown as VehicleShowcaseEntry[];
const visuals: Record<string, VehicleVisual> = {
  "kran-manipulyator": { image: "/images/vehicle-showcase/kran-manipulyator.webp", naturalWidth: 1086, naturalHeight: 1448 },
};

let observers: IntersectionObserverCallback[] = [];

beforeEach(() => {
  observers = [];
  class IntersectionObserverMock {
    constructor(callback: IntersectionObserverCallback) {
      observers.push(callback);
    }

    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("несостоявшаяся загрузка интерактивной витрины", () => {
  it("оставляет рабочую статическую витрину и предлагает повторить загрузку", async () => {
    const view = render(
      <VehicleShowcaseLazy entries={entries} visuals={visuals} defaultSlug="kran-manipulyator">
        <a href="#kran-manipulyator">Запчасти для «Кран-манипулятор»</a>
      </VehicleShowcaseLazy>,
    );

    const root = view.container.firstElementChild as HTMLElement;
    const heightBefore = root.className;

    act(() => {
      observers[0]?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Загрузить витрину" })).not.toBeNull());

    // Ссылки и содержимое заглушки на месте.
    expect(screen.getByRole("link", { name: /Кран-манипулятор/ })).not.toBeNull();
    // Кнопка повтора вынута из потока, поэтому размеры секции не меняются.
    expect(screen.getByRole("button", { name: "Загрузить витрину" }).className).toContain("absolute");
    expect(root.className).toBe(heightBefore);
  });
});
