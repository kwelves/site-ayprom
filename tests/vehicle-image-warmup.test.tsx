// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VehicleImageWarmup } from "@/components/home/vehicle-showcase/VehicleImageWarmup";
import { collectVehicleImageWarmupCandidates, type VehicleVisual } from "@/components/home/vehicle-showcase/VehicleShowcaseInteractive";
import type { VehicleShowcaseEntry } from "@/lib/queries/vehicle-hotspots";

const imageApi = vi.hoisted(() => ({
  // Mirrors real next/image behavior for `unoptimized: true`: the raw src
  // passes through untouched, with no `/_next/image` proxy URL and no
  // generated srcSet.
  getImageProps: vi.fn(({ src }: { src: string }) => ({
    props: {
      src,
      loading: "eager",
      decoding: "async",
    },
  })),
}));

vi.mock("next/image", () => ({
  default: () => null,
  getImageProps: imageApi.getImageProps,
}));

const candidates = [
  { slug: "default", image: "/images/vehicle-showcase/default.png", naturalWidth: 1086, naturalHeight: 1448 },
  { slug: "second", image: "/images/vehicle-showcase/second.png", naturalWidth: 1024, naturalHeight: 1536 },
  { slug: "third", image: "/images/vehicle-showcase/third.png", naturalWidth: 1086, naturalHeight: 1448 },
];

let idleCallbacks: IdleRequestCallback[] = [];
const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
  idleCallbacks.push(callback);
  return idleCallbacks.length;
});
const cancelIdleCallback = vi.fn();

function setConnection(connection: { effectiveType?: "slow-2g" | "2g" | "3g" | "4g"; saveData?: boolean } | undefined) {
  Object.defineProperty(navigator, "connection", { configurable: true, value: connection });
}

function setVisibility(visibilityState: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: visibilityState });
}

function runOneIdleCallback() {
  const callback = idleCallbacks.shift();
  if (!callback) throw new Error("Не запланирован idle callback");
  act(() => callback({ didTimeout: false, timeRemaining: () => 50 }));
}

function renderWarmup(enabled = true) {
  return render(<VehicleImageWarmup candidates={candidates} defaultSlug="default" enabled={enabled} />);
}

beforeEach(() => {
  idleCallbacks = [];
  imageApi.getImageProps.mockClear();
  requestIdleCallback.mockClear();
  cancelIdleCallback.mockClear();
  setConnection({ effectiveType: "4g", saveData: false });
  setVisibility("visible");
  Object.defineProperty(window, "requestIdleCallback", { configurable: true, value: requestIdleCallback });
  Object.defineProperty(window, "cancelIdleCallback", { configurable: true, value: cancelIdleCallback });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("VehicleImageWarmup", () => {
  it("прогревает только одну следующую технику по тому же прямому URL, что и видимая сцена", () => {
    const view = renderWarmup();
    expect(requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(view.container.querySelectorAll("img")).toHaveLength(0);

    runOneIdleCallback();
    const first = view.container.querySelector("img");
    expect(first).not.toBeNull();
    expect(first?.getAttribute("src")).toBe(candidates[1].image);
    expect(first?.getAttribute("fetchpriority")).toBe("low");
    expect(view.container.querySelectorAll("img")).toHaveLength(1);

    fireEvent.load(first!);
    expect(requestIdleCallback).toHaveBeenCalledTimes(2);
    expect(view.container.querySelectorAll("img")).toHaveLength(0);

    runOneIdleCallback();
    const second = view.container.querySelector("img");
    expect(second?.getAttribute("src")).toBe(candidates[2].image);
    expect(view.container.querySelectorAll("img")).toHaveLength(1);
  });

  it.each([
    ["Save-Data", { saveData: true }],
    ["3G", { effectiveType: "3g" as const }],
    ["2G", { effectiveType: "2g" as const }],
  ])("не запускается при %s", (_name, connection) => {
    setConnection(connection);
    renderWarmup();
    expect(requestIdleCallback).not.toHaveBeenCalled();
  });

  it("не запускается в скрытой вкладке", () => {
    setVisibility("hidden");
    renderWarmup();
    expect(requestIdleCallback).not.toHaveBeenCalled();
  });

  it.each([undefined, { effectiveType: "4g" as const }])("не запускается без явного сигнала 4G и выключенного Save-Data", (connection) => {
    setConnection(connection);
    renderWarmup();
    expect(requestIdleCallback).not.toHaveBeenCalled();
  });

  it("снимает ожидающую или активную фоновую загрузку при вводе и переходе сцены", () => {
    const view = renderWarmup();
    const waitingCallback = idleCallbacks.shift();
    if (!waitingCallback) throw new Error("Не запланирован idle callback");

    act(() => window.dispatchEvent(new Event("pointerdown")));
    expect(cancelIdleCallback).toHaveBeenCalled();
    act(() => waitingCallback({ didTimeout: false, timeRemaining: () => 50 }));
    expect(view.container.querySelector("img")).toBeNull();

    // A fresh render represents a newly idle scene. Once its low-priority
    // img exists, a vehicle transition (`enabled=false`) removes it again.
    view.unmount();
    const transitionView = renderWarmup();
    runOneIdleCallback();
    expect(transitionView.container.querySelector("img")).not.toBeNull();
    transitionView.rerender(<VehicleImageWarmup candidates={candidates} defaultSlug="default" enabled={false} />);
    expect(transitionView.container.querySelector("img")).toBeNull();
  });

  it("передаёт в очередь только большие фото техники, а не связанные изображения товаров", () => {
    const entries = [
      {
        vehicleType: { slug: "vehicle-a", name: "Техника" },
        hotspots: [
          {
            id: "hotspot-a",
            hotspotNumber: 1,
            label: "КОМ",
            xPct: 30,
            yPct: 40,
            product: {
              slug: "product-a",
              name: "Товар",
              shortDescription: "Описание",
              images: [{ url: "https://storage.example/product-preview.png" }],
            },
          },
        ],
      },
    ] as unknown as VehicleShowcaseEntry[];
    const visuals: Record<string, VehicleVisual> = {
      "vehicle-a": { image: "/images/vehicle-showcase/vehicle-a.png", naturalWidth: 1086, naturalHeight: 1448 },
    };

    expect(collectVehicleImageWarmupCandidates(entries, visuals, true)).toEqual([
      { slug: "vehicle-a", image: "/images/vehicle-showcase/vehicle-a.png", naturalWidth: 1086, naturalHeight: 1448 },
    ]);
  });

  it("на мобильных ширинах ставит в очередь уменьшенный файл, если он задан", () => {
    const entries = [
      { vehicleType: { slug: "vehicle-a", name: "Техника" }, hotspots: [] },
    ] as unknown as VehicleShowcaseEntry[];
    const visuals: Record<string, VehicleVisual> = {
      "vehicle-a": {
        image: "/images/vehicle-showcase/vehicle-a.webp",
        imageMobile: "/images/vehicle-showcase/vehicle-a-mobile.webp",
        naturalWidth: 1086,
        naturalHeight: 1448,
      },
    };

    expect(collectVehicleImageWarmupCandidates(entries, visuals, false)[0]?.image).toBe(
      "/images/vehicle-showcase/vehicle-a-mobile.webp",
    );
    expect(collectVehicleImageWarmupCandidates(entries, visuals, true)[0]?.image).toBe(
      "/images/vehicle-showcase/vehicle-a.webp",
    );
  });
});
