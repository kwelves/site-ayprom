// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoverBorderGrid } from "@/components/motion/HoverBorderGrid";
import { HOVER_BORDER_OVERHANG } from "@/lib/card-system";

type RectInput = Pick<DOMRect, "left" | "top" | "width" | "height">;

function domRect({ left, top, width, height }: RectInput): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function setRect(element: Element, read: () => RectInput) {
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => domRect(read()));
}

/** Длительности перехода в порядке transform, width, height, opacity. */
function durations(element: Element): number[] {
  const value = (element as HTMLElement).style.transitionDuration;
  return value.split(",").map((part) => Number.parseFloat(part.trim()));
}

function geometry(element: Element) {
  const style = (element as HTMLElement).style;
  return {
    transform: style.transform,
    width: style.width,
    height: style.height,
    opacity: style.opacity,
  };
}

function setReducedMotion(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduced && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
}

function TestGrid({ withThird = false }: { withThird?: boolean }) {
  return (
    <HoverBorderGrid className="test-grid">
      <div>
        <a href="/one" data-hover-border-item data-testid="one">
          <span data-testid="one-child">Первая</span>
        </a>
        <a href="/two" data-hover-border-item data-testid="two">
          Вторая
        </a>
        {withThird && (
          <a href="/three" data-hover-border-item data-testid="three">
            Третья
          </a>
        )}
      </div>
    </HoverBorderGrid>
  );
}

let queuedFrame: FrameRequestCallback | null;
let resizeCallback: ResizeObserverCallback | null;

beforeEach(() => {
  setReducedMotion(false);
  queuedFrame = null;
  resizeCallback = null;
  class PointerEventMock extends MouseEvent {
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      Object.defineProperty(this, "pointerType", {
        configurable: true,
        value: init.pointerType ?? "",
      });
    }
  }
  vi.stubGlobal("PointerEvent", PointerEventMock);
  class ResizeObserverMock {
    constructor(callback: ResizeObserverCallback) {
      resizeCallback = callback;
    }

    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    queuedFrame = callback;
    return 1;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn(() => {
    queuedFrame = null;
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HoverBorderGrid", () => {
  it("рисует одну подложку и переносит её между карточками CSS-переходом", () => {
    const view = render(<TestGrid />);
    const grid = view.container.querySelector("[data-hover-border-grid]");
    const first = view.getByTestId("one");
    const second = view.getByTestId("two");

    expect(grid).not.toBeNull();
    expect(view.container.querySelector("[data-hover-border-highlight]")).toBeNull();
    setRect(grid!, () => ({ left: 100, top: 50, width: 700, height: 500 }));
    setRect(first, () => ({ left: 120, top: 90, width: 200, height: 120 }));
    setRect(second, () => ({ left: 350, top: 90, width: 180, height: 150 }));

    fireEvent.pointerOver(view.getByTestId("one-child"), {
      pointerType: "mouse",
      clientX: 140,
      clientY: 100,
    });

    const highlight = view.container.querySelector("[data-hover-border-highlight]");
    expect(highlight).not.toBeNull();
    expect(highlight?.getAttribute("aria-hidden")).toBe("true");
    // Первое появление — на месте: подложка не приезжает через всю сетку.
    expect(durations(highlight!)[0]).toBe(0);
    expect(geometry(highlight!)).toEqual({
      transform: `translate3d(${20 - HOVER_BORDER_OVERHANG}px, ${40 - HOVER_BORDER_OVERHANG}px, 0)`,
      width: `${200 + HOVER_BORDER_OVERHANG * 2}px`,
      height: `${120 + HOVER_BORDER_OVERHANG * 2}px`,
      opacity: "1",
    });

    fireEvent.pointerMove(second, { pointerType: "mouse", clientX: 370, clientY: 100 });

    const moved = view.container.querySelector("[data-hover-border-highlight]");
    expect(moved).toBe(highlight);
    expect(view.container.querySelectorAll("[data-hover-border-highlight]")).toHaveLength(1);
    expect(geometry(moved!)).toEqual({
      transform: `translate3d(${250 - HOVER_BORDER_OVERHANG}px, ${40 - HOVER_BORDER_OVERHANG}px, 0)`,
      width: `${180 + HOVER_BORDER_OVERHANG * 2}px`,
      height: `${150 + HOVER_BORDER_OVERHANG * 2}px`,
      opacity: "1",
    });
    // Переезд между карточками — уже с движением.
    expect(durations(moved!).slice(0, 3)).toEqual([500, 500, 500]);

    fireEvent.pointerLeave(grid!, { pointerType: "mouse" });
    const leaving = view.container.querySelector("[data-hover-border-highlight]");
    expect(leaving).toBe(highlight);
    expect((leaving as HTMLElement).style.opacity).toBe("0");
  });

  it("не включает hover для touch и pen", () => {
    const view = render(<TestGrid />);
    const grid = view.container.querySelector("[data-hover-border-grid]")!;
    const first = view.getByTestId("one");
    setRect(grid, () => ({ left: 0, top: 0, width: 500, height: 300 }));
    setRect(first, () => ({ left: 10, top: 10, width: 100, height: 100 }));

    fireEvent.pointerMove(first, { pointerType: "touch", clientX: 20, clientY: 20 });
    fireEvent.pointerMove(first, { pointerType: "pen", clientX: 20, clientY: 20 });

    expect(view.container.querySelector("[data-hover-border-highlight]")).toBeNull();
  });

  it("синхронизирует подложку без запаздывания после resize, layout shift и scroll", () => {
    const view = render(<TestGrid />);
    const grid = view.container.querySelector("[data-hover-border-grid]")!;
    const first = view.getByTestId("one");
    const second = view.getByTestId("two");
    const firstRect = { left: 20, top: 30, width: 100, height: 80 };
    setRect(grid, () => ({ left: 0, top: 0, width: 500, height: 300 }));
    setRect(first, () => firstRect);
    setRect(second, () => ({ left: 300, top: 30, width: 100, height: 80 }));
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => first),
    });

    // Сначала переезд между карточками, чтобы подложка была «в движении».
    fireEvent.pointerMove(second, { pointerType: "mouse", clientX: 320, clientY: 50 });
    fireEvent.pointerMove(first, { pointerType: "mouse", clientX: 40, clientY: 50 });
    expect(durations(view.container.querySelector("[data-hover-border-highlight]")!)[0]).toBe(500);

    firstRect.left = 70;
    firstRect.top = 90;
    act(() => resizeCallback?.([], {} as ResizeObserver));
    expect(queuedFrame).not.toBeNull();

    act(() => {
      const callback = queuedFrame;
      queuedFrame = null;
      callback?.(0);
    });

    const highlight = view.container.querySelector("[data-hover-border-highlight]")!;
    expect((highlight as HTMLElement).style.transform).toBe(
      `translate3d(${70 - HOVER_BORDER_OVERHANG}px, ${90 - HOVER_BORDER_OVERHANG}px, 0)`,
    );
    expect(durations(highlight)).toEqual([0, 0, 0, 150]);

    firstRect.left = 110;
    fireEvent.scroll(window);
    act(() => {
      const callback = queuedFrame;
      queuedFrame = null;
      callback?.(0);
    });
    expect((highlight as HTMLElement).style.transform).toBe(
      `translate3d(${110 - HOVER_BORDER_OVERHANG}px, ${90 - HOVER_BORDER_OVERHANG}px, 0)`,
    );
  });

  it("автоматически принимает карточки, добавленные после первого рендера", () => {
    const view = render(<TestGrid />);
    view.rerender(<TestGrid withThird />);
    const grid = view.container.querySelector("[data-hover-border-grid]")!;
    const third = view.getByTestId("three");
    setRect(grid, () => ({ left: 0, top: 0, width: 600, height: 400 }));
    setRect(third, () => ({ left: 250, top: 170, width: 140, height: 90 }));

    fireEvent.pointerMove(third, { pointerType: "mouse", clientX: 270, clientY: 190 });

    const highlight = view.container.querySelector("[data-hover-border-highlight]")!;
    expect(geometry(highlight)).toMatchObject({
      transform: `translate3d(${250 - HOVER_BORDER_OVERHANG}px, ${170 - HOVER_BORDER_OVERHANG}px, 0)`,
      width: `${140 + HOVER_BORDER_OVERHANG * 2}px`,
      height: `${90 + HOVER_BORDER_OVERHANG * 2}px`,
    });
  });

  it("убирает движение при prefers-reduced-motion", () => {
    setReducedMotion(true);
    const view = render(<TestGrid />);
    const grid = view.container.querySelector("[data-hover-border-grid]")!;
    const first = view.getByTestId("one");
    const second = view.getByTestId("two");
    setRect(grid, () => ({ left: 0, top: 0, width: 500, height: 300 }));
    setRect(first, () => ({ left: 10, top: 10, width: 100, height: 100 }));
    setRect(second, () => ({ left: 200, top: 10, width: 100, height: 100 }));

    fireEvent.pointerMove(first, { pointerType: "mouse", clientX: 20, clientY: 20 });
    fireEvent.pointerMove(second, { pointerType: "mouse", clientX: 220, clientY: 20 });

    const highlight = view.container.querySelector("[data-hover-border-highlight]")!;
    expect(durations(highlight)).toEqual([0, 0, 0, 0]);
  });

  it("подложка не перехватывает события указателя", () => {
    const view = render(<TestGrid />);
    const grid = view.container.querySelector("[data-hover-border-grid]")!;
    const first = view.getByTestId("one");
    setRect(grid, () => ({ left: 0, top: 0, width: 500, height: 300 }));
    setRect(first, () => ({ left: 10, top: 10, width: 100, height: 100 }));

    fireEvent.pointerMove(first, { pointerType: "mouse", clientX: 20, clientY: 20 });

    const highlight = view.container.querySelector("[data-hover-border-highlight]")!;
    expect(highlight.className).toContain("pointer-events-none");
  });
});
