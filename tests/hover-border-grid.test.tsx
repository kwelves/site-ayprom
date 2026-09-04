// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOVER_BORDER_OVERHANG, HoverBorderGrid } from "@/components/motion/HoverBorderGrid";

const motionState = vi.hoisted(() => ({ reduced: false }));

interface MotionSpanProps extends React.ComponentProps<"span"> {
  initial?: unknown;
  animate?: unknown;
  exit?: unknown;
  transition?: unknown;
}

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  useReducedMotion: () => motionState.reduced,
  motion: {
    span: ({ initial, animate, exit, transition, ...props }: MotionSpanProps) => (
      <span
        {...props}
        data-motion-initial={JSON.stringify(initial)}
        data-motion-animate={JSON.stringify(animate)}
        data-motion-exit={JSON.stringify(exit)}
        data-motion-transition={JSON.stringify(transition)}
      />
    ),
  },
}));

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

function jsonAttribute<T>(element: Element, name: string): T {
  return JSON.parse(element.getAttribute(name) ?? "null") as T;
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
  motionState.reduced = false;
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
  it("рисует одну подложку с геометрией и пружиной текущей сетки Каталога", () => {
    const view = render(<TestGrid />);
    const grid = view.container.querySelector("[data-hover-border-grid]");
    const first = view.getByTestId("one");
    const second = view.getByTestId("two");

    expect(grid).not.toBeNull();
    setRect(grid!, () => ({ left: 100, top: 50, width: 700, height: 500 }));
    setRect(first, () => ({ left: 120, top: 90, width: 200, height: 120 }));
    setRect(second, () => ({ left: 350, top: 90, width: 180, height: 150 }));

    fireEvent.pointerOver(view.getByTestId("one-child"), {
      pointerType: "mouse",
      clientX: 140,
      clientY: 100,
    });

    const firstHighlight = view.container.querySelector("[data-hover-border-highlight]");
    expect(firstHighlight).not.toBeNull();
    expect(jsonAttribute(firstHighlight!, "data-motion-animate")).toEqual({
      opacity: 1,
      x: 20 - HOVER_BORDER_OVERHANG,
      y: 40 - HOVER_BORDER_OVERHANG,
      width: 200 + HOVER_BORDER_OVERHANG * 2,
      height: 120 + HOVER_BORDER_OVERHANG * 2,
    });
    expect(jsonAttribute(firstHighlight!, "data-motion-transition")).toEqual({
      type: "spring",
      bounce: 0.2,
      duration: 0.5,
    });

    fireEvent.pointerMove(second, { pointerType: "mouse", clientX: 370, clientY: 100 });

    const secondHighlight = view.container.querySelector("[data-hover-border-highlight]");
    expect(secondHighlight).toBe(firstHighlight);
    expect(view.container.querySelectorAll("[data-hover-border-highlight]")).toHaveLength(1);
    expect(jsonAttribute(secondHighlight!, "data-motion-animate")).toEqual({
      opacity: 1,
      x: 250 - HOVER_BORDER_OVERHANG,
      y: 40 - HOVER_BORDER_OVERHANG,
      width: 180 + HOVER_BORDER_OVERHANG * 2,
      height: 150 + HOVER_BORDER_OVERHANG * 2,
    });

    fireEvent.pointerLeave(grid!, { pointerType: "mouse" });
    expect(view.container.querySelector("[data-hover-border-highlight]")).toBeNull();
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

  it("синхронизирует подложку без пружинного запаздывания после resize, layout shift и scroll", () => {
    const view = render(<TestGrid />);
    const grid = view.container.querySelector("[data-hover-border-grid]")!;
    const first = view.getByTestId("one");
    const firstRect = { left: 20, top: 30, width: 100, height: 80 };
    setRect(grid, () => ({ left: 0, top: 0, width: 500, height: 300 }));
    setRect(first, () => firstRect);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => first),
    });

    fireEvent.pointerMove(first, { pointerType: "mouse", clientX: 40, clientY: 50 });
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
    expect(jsonAttribute(highlight, "data-motion-animate")).toMatchObject({ x: 70 - HOVER_BORDER_OVERHANG, y: 90 - HOVER_BORDER_OVERHANG });
    expect(jsonAttribute(highlight, "data-motion-transition")).toEqual({ duration: 0 });

    firstRect.left = 110;
    fireEvent.scroll(window);
    act(() => {
      const callback = queuedFrame;
      queuedFrame = null;
      callback?.(0);
    });
    expect(jsonAttribute(highlight, "data-motion-animate")).toMatchObject({ x: 110 - HOVER_BORDER_OVERHANG, y: 90 - HOVER_BORDER_OVERHANG });
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
    expect(jsonAttribute(highlight, "data-motion-animate")).toMatchObject({
      x: 250 - HOVER_BORDER_OVERHANG,
      y: 170 - HOVER_BORDER_OVERHANG,
      width: 140 + HOVER_BORDER_OVERHANG * 2,
      height: 90 + HOVER_BORDER_OVERHANG * 2,
    });
  });

  it("убирает пространственную анимацию при prefers-reduced-motion", () => {
    motionState.reduced = true;
    const view = render(<TestGrid />);
    const grid = view.container.querySelector("[data-hover-border-grid]")!;
    const first = view.getByTestId("one");
    setRect(grid, () => ({ left: 0, top: 0, width: 500, height: 300 }));
    setRect(first, () => ({ left: 10, top: 10, width: 100, height: 100 }));

    fireEvent.pointerMove(first, { pointerType: "mouse", clientX: 20, clientY: 20 });

    const highlight = view.container.querySelector("[data-hover-border-highlight]")!;
    expect(jsonAttribute(highlight, "data-motion-transition")).toEqual({ duration: 0 });
    expect(jsonAttribute(highlight, "data-motion-exit")).toEqual({
      opacity: 0,
      transition: { duration: 0 },
    });
  });
});
