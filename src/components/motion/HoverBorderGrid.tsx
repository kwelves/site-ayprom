"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { HOVER_BORDER_OVERHANG } from "@/lib/card-system";
import { DURATION } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";

// Карточка подключается к сетке своим видимым краем: обёртка с собственным
// padding между `data-hover-border-item` и рамкой раздула бы halo, потому что
// подсветка меряется по прямоугольнику самого элемента с этим атрибутом.
// Величина выступа — токен дизайн-системы, см. HOVER_BORDER_OVERHANG.
const ITEM_SELECTOR = "[data-hover-border-item]";
const POSITION_EPSILON = 0.25;

// Прежняя пружина (`type: "spring", bounce: 0.2, duration: 0.5`) в виде
// CSS-перехода: та же длительность и такой же лёгкий перелёт в конце, но без
// рантайма framer-motion на первом экране. Переезд рамки и её появление
// разведены: перелёт уместен в движении между карточками и неуместен в
// прозрачности.
const HIGHLIGHT_MOVE_MS = 500;
const HIGHLIGHT_MOVE_EASING = "cubic-bezier(0.34, 1.28, 0.62, 1)";
const HIGHLIGHT_FADE_MS = DURATION.fast * 1000;

interface HighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
  instant: boolean;
}

interface HoverBorderGridProps {
  children: React.ReactNode;
  className?: string;
}

function isSameRect(current: HighlightRect | null, next: HighlightRect): boolean {
  if (!current) return false;
  return (
    Math.abs(current.x - next.x) < POSITION_EPSILON &&
    Math.abs(current.y - next.y) < POSITION_EPSILON &&
    Math.abs(current.width - next.width) < POSITION_EPSILON &&
    Math.abs(current.height - next.height) < POSITION_EPSILON &&
    current.instant === next.instant
  );
}

function findItemFromTarget(container: HTMLElement, target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const item = target.closest<HTMLElement>(ITEM_SELECTOR);
  return item && container.contains(item) ? item : null;
}

/**
 * One mouse-only moving highlight for an entire card grid. Cards opt in with
 * `data-hover-border-item`; event delegation keeps the cost constant when
 * more cards are added. Server Components can stay on the server by passing
 * their rendered card tree through `children`.
 */
export function HoverBorderGrid({ children, className }: HoverBorderGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLElement | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  // Видима ли рамка прямо сейчас. Нужен именно ref: решение «переезжать или
  // появиться на месте» принимается внутри обработчика указателя, до того как
  // React применит новое состояние.
  const visibleRef = useRef(false);
  const [activeItem, setActiveItem] = useState<HTMLElement | null>(null);
  const [highlight, setHighlight] = useState<HighlightRect | null>(null);
  // Рамка не размонтируется вместе с уходом курсора: она гасится прозрачностью,
  // чтобы уход оставался плавным, как раньше с AnimatePresence.
  const [visible, setVisible] = useState(false);
  const shouldReduceMotion = usePrefersReducedMotion();

  const clearHighlight = useCallback(() => {
    activeItemRef.current = null;
    lastPointerRef.current = null;
    visibleRef.current = false;
    setActiveItem(null);
    setVisible(false);
  }, []);

  const measureItem = useCallback((item: HTMLElement, instant: boolean) => {
    const container = containerRef.current;
    if (!container || !item.isConnected || !container.contains(item)) {
      clearHighlight();
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const next: HighlightRect = {
      x: itemRect.left - containerRect.left - HOVER_BORDER_OVERHANG,
      y: itemRect.top - containerRect.top - HOVER_BORDER_OVERHANG,
      width: itemRect.width + HOVER_BORDER_OVERHANG * 2,
      height: itemRect.height + HOVER_BORDER_OVERHANG * 2,
      instant,
    };

    setHighlight((current) => (isSameRect(current, next) ? current : next));
  }, [clearHighlight]);

  const activateItem = useCallback((item: HTMLElement, instant: boolean) => {
    // Повторное появление после полного ухода — не переезд: рамка обязана
    // возникнуть сразу на новой карточке и проявиться там, иначе погашенный
    // прямоугольник поехал бы через всю сетку и «проявился на лету».
    const appearing = !visibleRef.current;
    if (activeItemRef.current !== item) {
      activeItemRef.current = item;
      setActiveItem(item);
    }
    visibleRef.current = true;
    setVisible(true);
    measureItem(item, instant || appearing);
  }, [measureItem]);

  const syncToPointer = useCallback(() => {
    frameRef.current = null;
    const container = containerRef.current;
    const pointer = lastPointerRef.current;
    if (!container || !pointer) return;

    const target = document.elementFromPoint(pointer.x, pointer.y);
    const item = findItemFromTarget(container, target);
    if (!item) {
      clearHighlight();
      return;
    }
    activateItem(item, true);
  }, [activateItem, clearHighlight]);

  const scheduleSyncToPointer = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(syncToPointer);
  }, [syncToPointer]);

  useEffect(() => {
    if (!activeItem) return;

    const container = containerRef.current;
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleSyncToPointer);
    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(scheduleSyncToPointer);
    if (container) resizeObserver?.observe(container);
    resizeObserver?.observe(activeItem);
    if (container) {
      mutationObserver?.observe(container, {
        childList: true,
        subtree: true,
      });
    }

    window.addEventListener("scroll", scheduleSyncToPointer, { capture: true, passive: true });
    window.addEventListener("resize", scheduleSyncToPointer, { passive: true });

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("scroll", scheduleSyncToPointer, true);
      window.removeEventListener("resize", scheduleSyncToPointer);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [activeItem, scheduleSyncToPointer]);

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;
    const container = containerRef.current;
    if (!container) return;

    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    const item = findItemFromTarget(container, event.target);
    if (!item) {
      clearHighlight();
      return;
    }
    if (activeItemRef.current !== item || !visibleRef.current) activateItem(item, false);
  };

  const handlePointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") clearHighlight();
  };

  const moveMs = shouldReduceMotion || highlight?.instant ? 0 : HIGHLIGHT_MOVE_MS;
  const fadeMs = shouldReduceMotion ? 0 : HIGHLIGHT_FADE_MS;
  const highlightStyle: CSSProperties | null = highlight
    ? {
        transform: `translate3d(${highlight.x}px, ${highlight.y}px, 0)`,
        width: highlight.width,
        height: highlight.height,
        opacity: visible ? 1 : 0,
        transitionProperty: "transform, width, height, opacity",
        transitionDuration: `${moveMs}ms, ${moveMs}ms, ${moveMs}ms, ${fadeMs}ms`,
        transitionTimingFunction: `${HIGHLIGHT_MOVE_EASING}, ${HIGHLIGHT_MOVE_EASING}, ${HIGHLIGHT_MOVE_EASING}, ease-out`,
      }
    : null;

  return (
    <div
      ref={containerRef}
      data-hover-border-grid
      className={cn("relative isolate", className)}
      onPointerOver={handlePointerMove}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {highlightStyle && (
        <span
          data-hover-border-highlight
          data-hover-border-visible={String(visible)}
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 z-0 block rounded-2xl bg-card-hover-highlight"
          style={highlightStyle}
        />
      )}

      <div className="relative z-10">{children}</div>
    </div>
  );
}
