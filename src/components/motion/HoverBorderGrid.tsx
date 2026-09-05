"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { HOVER_BORDER_OVERHANG } from "@/lib/card-system";
import { cn } from "@/lib/utils";

// Карточка подключается к сетке своим видимым краем: обёртка с собственным
// padding между `data-hover-border-item` и рамкой раздула бы halo, потому что
// подсветка меряется по прямоугольнику самого элемента с этим атрибутом.
// Величина выступа — токен дизайн-системы, см. HOVER_BORDER_OVERHANG.
const ITEM_SELECTOR = "[data-hover-border-item]";
const POSITION_EPSILON = 0.25;
export interface HighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
  instant: boolean;
}

type HighlightRenderer = React.ComponentType<{ highlight: HighlightRect | null }>;
let highlightRendererPromise: Promise<HighlightRenderer> | null = null;

function loadHighlightRenderer(): Promise<HighlightRenderer> {
  if (!highlightRendererPromise) {
    highlightRendererPromise = import("@/components/motion/HoverBorderHighlight")
      .then((module) => module.HoverBorderHighlight)
      .catch((error) => {
        highlightRendererPromise = null;
        throw error;
      });
  }
  return highlightRendererPromise;
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
  const [activeItem, setActiveItem] = useState<HTMLElement | null>(null);
  const [highlight, setHighlight] = useState<HighlightRect | null>(null);
  const [HighlightRenderer, setHighlightRenderer] = useState<HighlightRenderer | null>(null);

  const requestHighlightRenderer = useCallback(() => {
    void loadHighlightRenderer()
      .then((Renderer) => setHighlightRenderer(() => Renderer))
      .catch(() => {
        // Карточки остаются полностью рабочими без декоративной подсветки;
        // следующая встреча указателя повторит загрузку чанка.
      });
  }, []);

  useEffect(() => {
    if (HighlightRenderer) return;
    // Лабораторные измерения не получают пользовательского ввода, поэтому
    // Framer не возвращается в первоначальную загрузку страницы. У реального
    // пользователя первое движение мыши прогревает чанк задолго до того, как
    // курсор доберётся до карточек; touch/pen декоративная рамка не нужна.
    const warmOnMouseMove = (event: PointerEvent) => {
      if (event.pointerType === "mouse") {
        requestHighlightRenderer();
        window.removeEventListener("pointermove", warmOnMouseMove);
      }
    };
    window.addEventListener("pointermove", warmOnMouseMove, { passive: true });
    return () => window.removeEventListener("pointermove", warmOnMouseMove);
  }, [HighlightRenderer, requestHighlightRenderer]);

  const clearHighlight = useCallback(() => {
    activeItemRef.current = null;
    lastPointerRef.current = null;
    setActiveItem(null);
    setHighlight(null);
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
    if (activeItemRef.current !== item) {
      activeItemRef.current = item;
      setActiveItem(item);
    }
    measureItem(item, instant);
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
    if (!HighlightRenderer) requestHighlightRenderer();
    const container = containerRef.current;
    if (!container) return;

    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    const item = findItemFromTarget(container, event.target);
    if (!item) {
      clearHighlight();
      return;
    }
    if (activeItemRef.current !== item) activateItem(item, false);
  };

  const handlePointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") clearHighlight();
  };

  return (
    <div
      ref={containerRef}
      data-hover-border-grid
      className={cn("relative isolate", className)}
      onPointerOver={handlePointerMove}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {HighlightRenderer && <HighlightRenderer highlight={highlight} />}

      <div className="relative z-10">{children}</div>
    </div>
  );
}
