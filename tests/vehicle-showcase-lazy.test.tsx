// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VehicleShowcaseLazy } from "@/components/home/vehicle-showcase/VehicleShowcaseLazy";
import type { VehicleVisual } from "@/components/home/vehicle-showcase/vehicle-visual";
import type { VehicleShowcaseEntry } from "@/lib/queries/vehicle-hotspots";

// Счётчик реальных обращений к модулю витрины: фабрика мока выполняется ровно
// тогда, когда загрузчик действительно вызывает import().
const moduleLoads = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/components/home/vehicle-showcase/VehicleShowcaseInteractive", () => {
  moduleLoads.count += 1;
  return {
    VehicleShowcaseInteractive: () => <div data-testid="vehicle-interactive">интерактив</div>,
  };
});

const entries = [
  { vehicleType: { slug: "kran-manipulyator", name: "Кран-манипулятор" }, hotspots: [] },
] as unknown as VehicleShowcaseEntry[];
const visuals: Record<string, VehicleVisual> = {
  "kran-manipulyator": { image: "/images/vehicle-showcase/kran-manipulyator.webp", naturalWidth: 1086, naturalHeight: 1448 },
};

let observers: Array<{ callback: IntersectionObserverCallback; disconnected: boolean }> = [];

beforeEach(() => {
  moduleLoads.count = 0;
  observers = [];
  class IntersectionObserverMock {
    private readonly record: { callback: IntersectionObserverCallback; disconnected: boolean };

    constructor(callback: IntersectionObserverCallback) {
      this.record = { callback, disconnected: false };
      observers.push(this.record);
    }

    observe() {}
    unobserve() {}
    disconnect() {
      this.record.disconnected = true;
    }
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

function renderLazy() {
  return render(
    <VehicleShowcaseLazy entries={entries} visuals={visuals} defaultSlug="kran-manipulyator">
      <a href="#kran-manipulyator">Запчасти для «Кран-манипулятор»</a>
    </VehicleShowcaseLazy>,
  );
}

function approachSection() {
  act(() => {
    observers[0]?.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  });
}

describe("ленивая загрузка интерактивной витрины", () => {
  it("не запрашивает модуль витрины, пока секция не приблизилась к экрану", async () => {
    renderLazy();

    expect(observers).toHaveLength(1);
    expect(moduleLoads.count).toBe(0);
    // Статическая витрина уже полезна: ссылка работает без интерактива.
    expect(screen.getByRole("link", { name: /Кран-манипулятор/ })).not.toBeNull();
    expect(screen.queryByTestId("vehicle-interactive")).toBeNull();

    // Пересечения не было — модуль по-прежнему не запрошен.
    act(() => {
      observers[0]?.callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    await act(async () => {});
    expect(moduleLoads.count).toBe(0);
  });

  it("загружает модуль ровно один раз после срабатывания наблюдателя", async () => {
    renderLazy();
    approachSection();

    await waitFor(() => expect(screen.getByTestId("vehicle-interactive")).not.toBeNull());
    expect(moduleLoads.count).toBe(1);
    // Наблюдатель отключается сразу же: второго запроса за чанком не будет.
    expect(observers[0]?.disconnected).toBe(true);
  });

  it("после загрузки статическая заглушка уступает место интерактиву", async () => {
    renderLazy();
    approachSection();

    await waitFor(() => expect(screen.getByTestId("vehicle-interactive")).not.toBeNull());
    expect(screen.queryByRole("link", { name: /Кран-манипулятор/ })).toBeNull();
  });
});
