// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductGallery } from "@/components/catalog/ProductGallery";

vi.mock("@/lib/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

interface TestConnection {
  effectiveType?: string;
  saveData?: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
}

const originalConnectionDescriptor = Object.getOwnPropertyDescriptor(navigator, "connection");

function setConnection(connection: TestConnection | undefined) {
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    value: connection,
  });
}

function createObservableConnection(effectiveType: string, saveData = false) {
  const listeners = new Set<() => void>();
  const connection: TestConnection & { emitChange: () => void } = {
    effectiveType,
    saveData,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    emitChange: () => listeners.forEach((listener) => listener()),
  };
  return connection;
}

afterEach(() => {
  cleanup();
  if (originalConnectionDescriptor) {
    Object.defineProperty(navigator, "connection", originalConnectionDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "connection");
  }
});

const images = [
  { url: "/images/products/one.webp" },
  { url: "/images/products/two.webp", scale: 1.1 },
  { url: "/images/products/three.webp" },
];

describe("ProductGallery", () => {
  it("prioritizes only the first image and does not warm a neighbor before it decodes", async () => {
    setConnection(createObservableConnection("4g"));
    render(<ProductGallery images={images} alt="Фото товара" />);

    const firstImage = document.querySelector<HTMLImageElement>('[data-carousel-layer="committed"] img');
    expect(firstImage?.getAttribute("loading")).toBe("eager");
    expect(firstImage?.getAttribute("fetchpriority")).toBe("high");
    expect(document.querySelector('img[aria-hidden="true"]')).toBeNull();

    let finishDecode: (() => void) | undefined;
    const decodePromise = new Promise<void>((resolve) => {
      finishDecode = resolve;
    });
    Object.defineProperty(firstImage, "decode", {
      configurable: true,
      value: () => decodePromise,
    });
    fireEvent.load(firstImage!);
    expect(document.querySelector('img[aria-hidden="true"]')).toBeNull();

    await act(async () => finishDecode?.());
    await waitFor(() => expect(document.querySelector('img[aria-hidden="true"]')).not.toBeNull());
  });

  it("does not let a stale decode from the previous product warm the next product", async () => {
    setConnection(createObservableConnection("4g"));
    const previousImages = [
      { url: "/images/products/previous-one.webp" },
      { url: "/images/products/previous-two.webp" },
    ];
    const nextImages = [
      { url: "/images/products/next-one.webp" },
      { url: "/images/products/next-two.webp" },
    ];
    const { rerender } = render(<ProductGallery images={previousImages} alt="Предыдущий товар" />);
    const previousFirstImage = document.querySelector<HTMLImageElement>('[data-carousel-layer="committed"] img');
    let finishPreviousDecode: (() => void) | undefined;
    const previousDecode = new Promise<void>((resolve) => {
      finishPreviousDecode = resolve;
    });
    Object.defineProperty(previousFirstImage, "decode", {
      configurable: true,
      value: () => previousDecode,
    });

    fireEvent.load(previousFirstImage!);
    rerender(<ProductGallery images={nextImages} alt="Следующий товар" />);
    await act(async () => finishPreviousDecode?.());

    expect(document.querySelector('img[aria-hidden="true"]')).toBeNull();
    expect(Array.from(document.images).some((image) => image.src.includes("next-two.webp"))).toBe(false);

    fireEvent.load(document.querySelector<HTMLImageElement>('[data-carousel-layer="committed"] img')!);
    await waitFor(() => {
      const warmup = document.querySelector<HTMLImageElement>('img[aria-hidden="true"]');
      expect(warmup?.getAttribute("src")).toContain("next-two.webp");
    });
  });

  it("warms every other image after the first decodes, on any connection that is not slow or save-data", async () => {
    setConnection(createObservableConnection("4g"));
    render(<ProductGallery images={images} alt="Фото товара" />);

    fireEvent.load(document.querySelector<HTMLImageElement>('[data-carousel-layer="committed"] img')!);

    await waitFor(() => {
      const warmups = document.querySelectorAll<HTMLImageElement>('img[aria-hidden="true"]');
      expect(warmups).toHaveLength(2);
      expect(warmups[0].getAttribute("src")).toContain("two.webp");
      expect(warmups[1].getAttribute("src")).toContain("three.webp");
    });
  });

  it("also warms every other image when the Network Information API is absent (Safari, Firefox)", async () => {
    setConnection(undefined);
    render(<ProductGallery images={images} alt="Фото товара" />);

    fireEvent.load(document.querySelector<HTMLImageElement>('[data-carousel-layer="committed"] img')!);

    await waitFor(() => expect(document.querySelectorAll('img[aria-hidden="true"]')).toHaveLength(2));
  });

  it.each([
    ["Save-Data", { effectiveType: "4g", saveData: true }],
    ["2G", { effectiveType: "2g", saveData: false }],
    ["slow 2G", { effectiveType: "slow-2g", saveData: false }],
  ])("never warms in the background on an explicit %s signal", async (_name, signal) => {
    setConnection(createObservableConnection(signal.effectiveType, signal.saveData));
    render(<ProductGallery images={images} alt="Фото товара" />);

    fireEvent.load(document.querySelector<HTMLImageElement>('[data-carousel-layer="committed"] img')!);

    await waitFor(() => expect(document.querySelector('img[aria-hidden="true"]')).toBeNull());
  });

  it("adds and removes the warmup when the connection changes between slow and fast", async () => {
    const connection = createObservableConnection("2g");
    setConnection(connection);
    render(<ProductGallery images={images} alt="Фото товара" />);
    fireEvent.load(document.querySelector<HTMLImageElement>('[data-carousel-layer="committed"] img')!);

    expect(document.querySelector('img[aria-hidden="true"]')).toBeNull();

    connection.effectiveType = "4g";
    act(() => connection.emitChange());
    await waitFor(() => expect(document.querySelector('img[aria-hidden="true"]')).not.toBeNull());

    connection.effectiveType = "2g";
    act(() => connection.emitChange());
    await waitFor(() => expect(document.querySelector('img[aria-hidden="true"]')).toBeNull());
  });

  it("has the third image ready before the user selects it, so any photo switches without a network wait", async () => {
    setConnection(createObservableConnection("4g"));
    render(<ProductGallery images={images} alt="Фото товара" />);
    fireEvent.load(document.querySelector<HTMLImageElement>('[data-carousel-layer="committed"] img')!);

    await waitFor(() => expect(Array.from(document.images).some((image) => image.src.includes("three.webp"))).toBe(true));
    const requestsBefore = Array.from(document.images).filter((image) => image.src.includes("three.webp")).length;

    fireEvent.click(screen.getByRole("button", { name: "Показать фото 3" }));
    expect(requestsBefore).toBeGreaterThan(0);
    expect(Array.from(document.images).some((image) => image.src.includes("three.webp"))).toBe(true);
  });

  it("keeps the server and first hydrated render free of network-dependent warmups", async () => {
    setConnection(createObservableConnection("4g"));
    const serverMarkup = renderToString(<ProductGallery images={images} alt="Фото товара" />);
    expect(serverMarkup).not.toContain('aria-hidden="true" fetchPriority="low"');

    const container = document.createElement("div");
    container.innerHTML = serverMarkup;
    document.body.appendChild(container);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, <ProductGallery images={images} alt="Фото товара" />);
    });

    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/hydration|did not match/i);
    expect(container.querySelector('img[aria-hidden="true"]')).toBeNull();

    await act(async () => root?.unmount());
    consoleError.mockRestore();
    container.remove();
  });

  it("keeps the previous mobile-carousel frame until the next one loads", async () => {
    render(<ProductGallery images={images} alt="Фото товара" />);

    fireEvent.click(screen.getByRole("button", { name: "Следующее фото" }));

    const committed = document.querySelector<HTMLElement>('[data-carousel-layer="committed"]');
    const pending = document.querySelector<HTMLElement>('[data-carousel-layer="pending"]');
    expect(committed?.querySelector("img")?.getAttribute("src")).toContain("one.webp");
    expect(pending?.querySelector("img")?.getAttribute("src")).toContain("two.webp");

    fireEvent.load(pending!.querySelector("img")!);

    await waitFor(() => {
      expect(document.querySelectorAll('[data-carousel-layer="pending"]')).toHaveLength(0);
      expect(document.querySelector<HTMLElement>('[data-carousel-layer="committed"] img')?.style.transform).toBe(
        "scale(1.1)",
      );
    });
  });

  it("reveals a neutral fallback over the committed frame when the selected image fails", async () => {
    render(<ProductGallery images={images} alt="Фото товара" />);

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Следующее фото" }));
    const failPending = () => fireEvent.error(document.querySelector<HTMLImageElement>('[data-carousel-layer="pending"] img')!);
    // The selected photo is retried three times (0.5, 1.5 and 3.5 s) before the neutral fallback is revealed.
    failPending();
    expect(document.querySelector('[data-carousel-layer="committed"] [role="img"]')).toBeNull();
    act(() => { vi.advanceTimersByTime(500); });
    failPending();
    act(() => { vi.advanceTimersByTime(1500); });
    failPending();
    act(() => { vi.advanceTimersByTime(3500); });
    failPending();
    vi.useRealTimers();

    await waitFor(() => {
      const committed = document.querySelector<HTMLElement>('[data-carousel-layer="committed"]');
      expect(committed?.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain(
        "Фотография пока не добавлена",
      );
    });
  });

  it("reveals and commits the fallback when the selected image URL is empty", async () => {
    render(<ProductGallery images={[images[0], { url: "" }]} alt="Фото товара" />);

    fireEvent.click(screen.getByRole("button", { name: "Следующее фото" }));

    await waitFor(() => {
      const committed = document.querySelector<HTMLElement>('[data-carousel-layer="committed"]');
      expect(committed?.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain(
        "Фотография пока не добавлена",
      );
      expect(document.querySelector('[data-carousel-layer="pending"]')).toBeNull();
    });
  });

  it("does not render controls or neighbor warmups for one image", () => {
    render(<ProductGallery images={images.slice(0, 1)} alt="Фото товара" />);

    expect(screen.queryByRole("button", { name: "Предыдущее фото" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Следующее фото" })).toBeNull();
    expect(document.querySelector('img[aria-hidden="true"]')).toBeNull();
  });

  it("keeps every indicator touch target at 44 by 44 pixels", () => {
    const tenImages = Array.from({ length: 10 }, (_, index) => ({ url: `/images/products/${index}.webp` }));
    render(<ProductGallery images={tenImages} alt="Фото товара" />);

    const scrollRegion = screen.getByTestId("product-gallery-indicator-scroll");
    expect(scrollRegion.classList).toContain("w-full");
    expect(scrollRegion.classList).toContain("max-w-full");
    expect(scrollRegion.classList).toContain("overflow-x-auto");
    expect(scrollRegion.firstElementChild?.classList).toContain("w-max");

    for (const indicator of screen.getAllByRole("button", { name: /Показать фото/ })) {
      expect(indicator.classList).toContain("h-11");
      expect(indicator.classList).toContain("w-11");
      expect(indicator.querySelector("span")?.classList).toContain("h-2");
    }
  });

  it("scrolls only the local indicator rail when the active dot leaves its viewport", async () => {
    const tenImages = Array.from({ length: 10 }, (_, index) => ({ url: `/images/products/${index}.webp` }));
    render(<ProductGallery images={tenImages} alt="Фото товара" />);

    const scrollRegion = screen.getByTestId("product-gallery-indicator-scroll");
    const thirdIndicator = screen.getByRole("button", { name: "Показать фото 3" });
    Object.defineProperty(scrollRegion, "clientWidth", { configurable: true, value: 88 });
    Object.defineProperty(scrollRegion, "scrollLeft", { configurable: true, value: 0, writable: true });
    Object.defineProperty(thirdIndicator, "offsetLeft", { configurable: true, value: 88 });
    Object.defineProperty(thirdIndicator, "offsetWidth", { configurable: true, value: 44 });
    const scrollTo = vi.fn();
    Object.defineProperty(scrollRegion, "scrollTo", { configurable: true, value: scrollTo });

    fireEvent.click(thirdIndicator);

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ left: 44, behavior: "smooth" });
    });
  });
});
