"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { HotspotMarker } from "./HotspotMarker";
import { VehicleCarousel } from "./VehicleCarousel";
import { ProductPanel } from "./ProductPanel";
import { Connector } from "./Connector";
import { useContainRect } from "./useContainRect";
import { buildConnectorPaths, buildVerticalConnectorPath, type ConnectorPaths, type Rect } from "./connector-geometry";
import type { VehicleShowcaseEntry } from "@/lib/queries/vehicle-hotspots";

export interface VehicleVisual {
  image: string;
  naturalWidth: number;
  naturalHeight: number;
  /** How far beyond strict contain-fit to inflate the photo (1 = fits
   * exactly). Hotspots track this same scaled rect, so they stay pinned to
   * their equipment regardless of the value. */
  scale?: number;
  /** Real bottom edge of the opaque truck pixels, as % of naturalHeight —
   * see the comment in VehicleShowcaseSection.tsx for how it's measured. */
  contentBottomPct?: number;
}

interface VehicleShowcaseInteractiveProps {
  entries: VehicleShowcaseEntry[];
  visuals: Record<string, VehicleVisual>;
  defaultSlug: string;
}

// One fixed shape for every vehicle so switching vehicles never resizes the
// section — only the vehicle drawing (via object-contain) scales to fit
// inside it, and the whole thing is always fully visible, never cropped.
// Taller/near-square on narrow screens (there's no second column stealing
// width there, and the native photos are themselves portrait-ish) so the
// vehicle doesn't shrink to a speck; wide on desktop where the stage shares
// the row with the card.
const STAGE_ASPECT_CLASS = "aspect-[4/3] sm:aspect-[3/2] lg:aspect-video";

function toRect(domRect: DOMRect, containerRect: DOMRect): Rect {
  return {
    left: domRect.left - containerRect.left,
    top: domRect.top - containerRect.top,
    width: domRect.width,
    height: domRect.height,
  };
}

export function VehicleShowcaseInteractive({ entries, visuals, defaultSlug }: VehicleShowcaseInteractiveProps) {
  const shouldReduceMotion = useReducedMotion();
  const sectionRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const hotspotRefs = useRef(new Map<string, HTMLButtonElement>());

  const defaultIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.vehicleType.slug === defaultSlug),
  );

  const [activeVehicleIndex, setActiveVehicleIndex] = useState(defaultIndex);
  const [activeHotspotId, setActiveHotspotId] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [connectorPaths, setConnectorPaths] = useState<ConnectorPaths | null>(null);
  const [verticalPath, setVerticalPath] = useState<{ stem: string; terminal: { x: number; y: number } } | null>(null);
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 });

  const activeEntry = entries[activeVehicleIndex];
  const activeHotspot = activeEntry?.hotspots.find((hotspot) => hotspot.id === activeHotspotId) ?? null;
  const visual = visuals[activeEntry?.vehicleType.slug ?? ""];
  const containRect = useContainRect(stageRef, visual?.naturalWidth ?? 1, visual?.naturalHeight ?? 1, visual?.scale ?? 1);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setEntered(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!entered) return;
    const timer = setTimeout(() => setRevealed(true), shouldReduceMotion ? 0 : 700);
    return () => clearTimeout(timer);
  }, [entered, shouldReduceMotion]);

  const clearConnector = () => {
    setConnectorPaths(null);
    setVerticalPath(null);
  };

  // Switching vehicle shows a fresh set of hotspots for different equipment
  // — keeping a stale selection open would point the connector at the
  // wrong photo, so drop back to the centered no-selection state instead.
  const selectVehicle = (index: number) => {
    setActiveVehicleIndex(index);
    setActiveHotspotId(null);
    clearConnector();
  };

  const selectHotspot = (id: string) => {
    setActiveHotspotId((current) => {
      if (current === id) {
        clearConnector();
        return null;
      }
      return id;
    });
  };

  useLayoutEffect(() => {
    if (!activeHotspotId || !activeEntry) return;
    const container = containerRef.current;
    const hotspotEl = hotspotRefs.current.get(activeHotspotId);
    const cardEl = cardRef.current;
    if (!container || !hotspotEl || !cardEl) return;

    const compute = () => {
      const containerRect = container.getBoundingClientRect();
      setSvgSize({ width: containerRect.width, height: containerRect.height });
      const hotspotRect = toRect(hotspotEl.getBoundingClientRect(), containerRect);
      const cardRect = toRect(cardEl.getBoundingClientRect(), containerRect);

      if (isDesktop) {
        const obstacles = activeEntry.hotspots
          .filter((hotspot) => hotspot.id !== activeHotspotId)
          .map((hotspot) => hotspotRefs.current.get(hotspot.id))
          .filter((el): el is HTMLButtonElement => Boolean(el))
          .map((el) => toRect(el.getBoundingClientRect(), containerRect));
        setConnectorPaths(buildConnectorPaths(hotspotRect, cardRect, obstacles));
        setVerticalPath(null);
      } else {
        setVerticalPath(buildVerticalConnectorPath(hotspotRect, cardRect));
        setConnectorPaths(null);
      }
    };

    compute();
    const resizeObserver = new ResizeObserver(compute);
    resizeObserver.observe(container);
    resizeObserver.observe(cardEl);
    return () => resizeObserver.disconnect();
  }, [activeHotspotId, activeEntry, isDesktop]);

  const vehicleItems = useMemo(
    () =>
      entries.map((entry) => {
        const entryVisual = visuals[entry.vehicleType.slug];
        return {
          slug: entry.vehicleType.slug,
          name: entry.vehicleType.name,
          image: entryVisual?.image ?? "",
          naturalWidth: entryVisual?.naturalWidth ?? 1,
          naturalHeight: entryVisual?.naturalHeight ?? 1,
          contentBottomPct: entryVisual?.contentBottomPct ?? 100,
        };
      }),
    [entries, visuals],
  );

  if (!activeEntry || !visual) return null;

  const hotspotCount = activeEntry.hotspots.length;
  const activePaths = connectorPaths ?? verticalPath;

  const stage = (
    <div ref={stageRef} className={`relative w-full ${STAGE_ASPECT_CLASS}`}>
      {containRect.width > 0 && (
        // Not `fill` — `scale` on VehicleVisual can push the photo past
        // strict contain-fit on purpose, and `fill` always clamps to the
        // parent box. Explicit width/height (from the same scaled rect
        // hotspots use) lets it actually overflow; `max-w-none` beats
        // the global img{max-width:100%} reset that would otherwise shrink
        // it straight back down.
        <Image
          src={visual.image}
          alt={activeEntry.vehicleType.name}
          width={Math.round(containRect.width)}
          height={Math.round(containRect.height)}
          sizes="(max-width: 1023px) 90vw, 55vw"
          priority
          className="pointer-events-none absolute max-w-none"
          style={{ left: containRect.left, top: containRect.top, width: containRect.width, height: containRect.height }}
        />
      )}

      {revealed &&
        containRect.width > 0 &&
        activeEntry.hotspots.map((hotspot) => {
          const left = containRect.left + (hotspot.xPct / 100) * containRect.width;
          const top = containRect.top + (hotspot.yPct / 100) * containRect.height;
          return (
            <HotspotMarker
              key={hotspot.id}
              ref={(node) => {
                if (node) hotspotRefs.current.set(hotspot.id, node);
                else hotspotRefs.current.delete(hotspot.id);
              }}
              left={left}
              top={top}
              tooltipBelow={top < containRect.boxHeight * 0.2}
              tooltipAlign={left < containRect.boxWidth * 0.25 ? "start" : left > containRect.boxWidth * 0.75 ? "end" : "center"}
              label={hotspot.label}
              isActive={hotspot.id === activeHotspotId}
              revealDelay={hotspot.hotspotNumber * 0.08}
              onClick={() => selectHotspot(hotspot.id)}
            />
          );
        })}
    </div>
  );

  return (
    <div ref={sectionRef} className="relative">
      <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{activeEntry.vehicleType.name}</p>

      {/* `stage` stays in this exact spot in the tree at all times — it's
          never swapped between differently-shaped branches. Before reveal
          the grid is forced to one column (so the vehicle reads as
          centered, full width, nothing else on screen); the moment
          `revealed` flips, the lg:grid-cols-[...] class takes effect
          instantly (no transition property on grid-template-columns), at
          the same beat hotspots and the carousel pop in. Swapping `stage`
          between separate branches was tried first — React remounts the
          div when its position in the tree changes, which drops
          useContainRect's ResizeObserver silently (the ref re-attaches to
          a new node, but the effect's deps don't change, so it never
          reruns) and hotspots stopped rendering entirely. */}
      <div
        ref={containerRef}
        data-testid="vehicle-showcase-grid"
        className={`relative mt-3 grid grid-cols-1 gap-6 ${revealed ? "mx-auto lg:mx-0 lg:grid-cols-[1.3fr_1fr] lg:items-center lg:gap-10" : "mx-auto max-w-2xl"}`}
      >
        {stage}

        {revealed && (
          // Ref target for the connector measurement — stays mounted
          // across both hotspot switches and the hint↔card swap so it's
          // never a stale/removed node when geometry is (re)computed.
          <div ref={cardRef} data-testid="vehicle-card" className="min-h-[220px]">
            <AnimatePresence mode="wait">
              {activeHotspot ? (
                <motion.div
                  key={activeHotspot.id}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                >
                  <ProductPanel label={activeHotspot.label} product={activeHotspot.product} />
                </motion.div>
              ) : (
                <motion.div
                  key="hint"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="flex min-h-[220px] flex-col justify-center gap-2 px-2"
                >
                  <p className="text-4xl font-bold text-white/10 tabular-nums">
                    01—{String(hotspotCount).padStart(2, "0")}
                  </p>
                  <p className="text-sm text-slate-400">Нажмите на синий плюс, чтобы увидеть подходящее оборудование.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Keyed by the active hotspot so every switch is a fresh mount —
            restarting the draw from scratch and playing the previous
            line's exit (erase) instead of just re-pointing a persistent
            path at new coordinates. */}
        <AnimatePresence>
          {activePaths && (
            <svg
              key={activeHotspotId}
              aria-hidden="true"
              data-testid="vehicle-connector-svg"
              className="pointer-events-none absolute inset-0 z-10"
              width={svgSize.width}
              height={svgSize.height}
            >
              <Connector paths={activePaths} />
            </svg>
          )}
        </AnimatePresence>
      </div>

      {revealed && (
        <motion.div
          initial={{ scaleY: 0.4, opacity: 0 }}
          animate={{ scaleY: 1, opacity: 1 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.4, ease: [0.39, 0.575, 0.565, 1] }}
          className="mt-8"
        >
          <VehicleCarousel items={vehicleItems} activeIndex={activeVehicleIndex} onSelect={selectVehicle} />
        </motion.div>
      )}
    </div>
  );
}
