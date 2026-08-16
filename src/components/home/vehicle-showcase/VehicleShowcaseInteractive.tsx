"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { HotspotMarker, type TooltipAlign } from "./HotspotMarker";
import { VehicleCarousel } from "./VehicleCarousel";
import { ProductPanel } from "./ProductPanel";
import { Connector } from "./Connector";
import { useContainRect } from "./useContainRect";
import { buildConnectorPaths, buildVerticalConnectorPath, type ConnectorPaths, type Rect } from "./connector-geometry";
import type { VehicleShowcaseEntry } from "@/lib/queries/vehicle-hotspots";
import { DURATION } from "@/lib/motion";

export interface VehicleVisual {
  image: string;
  naturalWidth: number;
  naturalHeight: number;
  /** How far beyond strict contain-fit to inflate the photo (1 = fits
   * exactly). Hotspots track this same scaled rect, so they stay pinned to
   * their equipment regardless of the value. */
  scale?: number;
  /** Overrides `scale` at the lg breakpoint, where the stage's height comes
   * from available flex space (see STAGE_ASPECT_CLASS) instead of a fixed
   * aspect-ratio box — the same inflate factor that fits a tall aspect-video
   * box can overflow a much shorter one. Defaults to `scale`. */
  desktopScale?: number;
}

interface TooltipPlacement {
  below: boolean;
  align: TooltipAlign;
  gap?: 9 | 16 | 24 | 32;
}

// Per-(vehicle, hotspot label) tooltip placement, keyed because the generic
// "near top → below, near an edge → start/end" heuristic only reasons about
// the hotspot's position against the *stage* edges — it has no idea where
// the other 4 hotspots on the same truck actually are, so on any vehicle
// where hotspots cluster close together it just as often points a tooltip
// straight at a neighboring marker. Each entry here was picked by trying
// every (gap × below × align) combination against the real rendered DOM —
// each other marker's actual bounding box — and keeping the one with the
// fewest overlaps; `gap: 16/24/32` widens the default 9px clearance for
// hotspots still touching a neighbor at every below/align choice.
//
// Getting a trustworthy reading here took three retries because the
// measurement itself was lying in three different ways: (1) a same-hash
// `navigate` doesn't remount the carousel, so state from a previous probe
// leaks into the next one; (2) firing clicks back-to-back with no settle
// time desyncs the carousel's internal slot indices from the visible
// vehicle; (3) reading a tooltip's *live* (unhovered) box mid-transition
// catches it between its `opacity-0`/peek position and its hovered/settled
// one, since `transition-[opacity,transform]` animates that move — you
// have to swap in a transition-free class, measure, then restore, exactly
// like the candidate search below does. Every value here was reproduced
// twice from a hard `location.reload()` with `document.fonts.ready`
// awaited first. Two hotspots have no zero-overlap option at all —
// Самосвал's "Гидробак за кабиной" always touches "Распределитель"
// (their circles sit under one diameter apart), and Тонар's "Гидронасос"
// sits low enough on the truck that flipping it to `below` avoids every
// neighbor but clips the *grid's* `lg:overflow-hidden` bottom edge
// instead — a container clip that z-30 can't rescue, unlike a same-level
// sibling overlap, so `below: false` (overlaps 4 neighbors, 0 clip) beats
// `below: true` (0 overlaps, clips) here. HotspotMarker's hover/active
// z-30 is the backstop for both overlap cases, so the tooltip you're
// pointing at always paints over the marker(s) it still overlaps.
const TOOLTIP_PLACEMENT: Record<string, TooltipPlacement> = {
  "kran-manipulyator:Гидробак": { below: false, align: "center" },
  "kran-manipulyator:Гидронасос": { below: true, align: "center", gap: 16 },
  "kran-manipulyator:КОМ": { below: true, align: "center" },
  "kran-manipulyator:Гидрораспределитель": { below: false, align: "center" },
  "kran-manipulyator:Кнопка пневмоуправления": { below: false, align: "center" },

  "musorovoz:Кнопка пневмоуправления": { below: false, align: "center" },
  "musorovoz:Гидрораспределитель": { below: false, align: "center" },
  "musorovoz:КОМ": { below: true, align: "center" },
  "musorovoz:Гидронасос": { below: false, align: "center" },
  "musorovoz:Гидробак": { below: false, align: "center" },

  "samosval:Гидронасос": { below: true, align: "center" },
  "samosval:КОМ": { below: true, align: "center", gap: 32 },
  "samosval:Джойстик подъёма/опускания": { below: false, align: "end" },
  "samosval:Распределитель": { below: false, align: "center" },
  "samosval:Гидробак за кабиной": { below: false, align: "start" },

  "tyagach:Распределитель": { below: false, align: "start" },
  "tyagach:Джойстик подъёма/опускания": { below: false, align: "center" },
  "tyagach:Гидронасос": { below: false, align: "center" },
  "tyagach:КОМ": { below: false, align: "center", gap: 24 },
  "tyagach:Гидробак": { below: true, align: "center", gap: 16 },

  "avtovoz:Гидрораспределитель": { below: true, align: "center" },
  "avtovoz:Гидробак": { below: true, align: "center" },
  "avtovoz:КОМ": { below: true, align: "center" },
  "avtovoz:Гидронасос": { below: false, align: "center" },
  "avtovoz:Кнопка пневмоуправления": { below: false, align: "center" },
};

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
const STAGE_ASPECT_CLASS = "aspect-[4/3] sm:aspect-[3/2] lg:aspect-auto lg:h-full";

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
  // An outgoing connector can finish its animation after the user has
  // already selected another hotspot. Keep the currently expected id in a
  // ref so that stale completion callbacks never reveal the wrong card.
  const activeHotspotIdRef = useRef<string | null>(null);

  const defaultIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.vehicleType.slug === defaultSlug),
  );

  const [activeVehicleIndex, setActiveVehicleIndex] = useState(defaultIndex);
  const [activeHotspotId, setActiveHotspotId] = useState<string | null>(null);
  const [isCardRevealed, setIsCardRevealed] = useState(false);
  const [entered, setEntered] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [vehicleImageLoaded, setVehicleImageLoaded] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [connectorPaths, setConnectorPaths] = useState<ConnectorPaths | null>(null);
  const [verticalPath, setVerticalPath] = useState<{ stem: string; terminal: { x: number; y: number } } | null>(null);
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 });

  const activeEntry = entries[activeVehicleIndex];
  const activeHotspot = activeEntry?.hotspots.find((hotspot) => hotspot.id === activeHotspotId) ?? null;
  const visual = visuals[activeEntry?.vehicleType.slug ?? ""];
  const effectiveScale = isDesktop ? (visual?.desktopScale ?? visual?.scale ?? 1) : (visual?.scale ?? 1);
  const containRect = useContainRect(stageRef, visual?.naturalWidth ?? 1, visual?.naturalHeight ?? 1, effectiveScale);

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
    if (!entered || !vehicleImageLoaded) return;
    // Hotspots must never race ahead of the vehicle image. Their existing
    // cascade, connector, card and carousel animations stay untouched; this
    // only waits until the physical vehicle is actually ready to read first.
    const timer = setTimeout(() => setRevealed(true), shouldReduceMotion ? 0 : DURATION.base * 1000);
    return () => clearTimeout(timer);
  }, [entered, shouldReduceMotion, vehicleImageLoaded]);

  const clearConnector = () => {
    setConnectorPaths(null);
    setVerticalPath(null);
  };

  // Switching vehicle shows a fresh set of hotspots for different equipment
  // — keeping a stale selection open would point the connector at the
  // wrong photo, so drop back to the centered no-selection state instead.
  const selectVehicle = (index: number) => {
    setActiveVehicleIndex(index);
    activeHotspotIdRef.current = null;
    setActiveHotspotId(null);
    setIsCardRevealed(false);
    clearConnector();
  };

  const selectHotspot = (id: string) => {
    setIsCardRevealed(false);
    setActiveHotspotId((current) => {
      if (current === id) {
        activeHotspotIdRef.current = null;
        clearConnector();
        return null;
      }
      activeHotspotIdRef.current = id;
      return id;
    });
  };

  const revealCard = (hotspotId: string) => {
    if (activeHotspotIdRef.current === hotspotId) {
      setIsCardRevealed(true);
    }
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
      entries.map((entry) => ({
        slug: entry.vehicleType.slug,
        name: entry.vehicleType.name,
        image: visuals[entry.vehicleType.slug]?.image ?? "",
      })),
    [entries, visuals],
  );

  if (!activeEntry || !visual) return null;

  const hotspotCount = activeEntry.hotspots.length;
  const activePaths = connectorPaths ?? verticalPath;

  const stage = (
    <div ref={stageRef} className={`relative w-full lg:overflow-hidden ${STAGE_ASPECT_CLASS}`}>
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
          onLoad={() => setVehicleImageLoaded(true)}
          onError={() => setVehicleImageLoaded(true)}
          className="pointer-events-none absolute max-w-none"
          style={{ left: containRect.left, top: containRect.top, width: containRect.width, height: containRect.height }}
        />
      )}

      {revealed &&
        containRect.width > 0 &&
        activeEntry.hotspots.map((hotspot) => {
          const left = containRect.left + (hotspot.xPct / 100) * containRect.width;
          const top = containRect.top + (hotspot.yPct / 100) * containRect.height;
          // Falls back to the generic edge-based heuristic for any hotspot
          // not in the table (new DB data before it's been measured/added).
          const placement = TOOLTIP_PLACEMENT[`${activeEntry.vehicleType.slug}:${hotspot.label}`];
          const tooltipBelow = placement?.below ?? top < containRect.boxHeight * 0.2;
          const tooltipAlign = placement?.align ?? (left < containRect.boxWidth * 0.25 ? "start" : left > containRect.boxWidth * 0.75 ? "end" : "center");
          return (
            <HotspotMarker
              key={hotspot.id}
              ref={(node) => {
                if (node) hotspotRefs.current.set(hotspot.id, node);
                else hotspotRefs.current.delete(hotspot.id);
              }}
              left={left}
              top={top}
              tooltipBelow={tooltipBelow}
              tooltipAlign={tooltipAlign}
              tooltipGap={placement?.gap}
              label={hotspot.label}
              isActive={hotspot.id === activeHotspotId}
              size={activeEntry.vehicleType.slug === "tyagach" ? "tonar" : "standard"}
              revealDelay={hotspot.hotspotNumber * 0.08}
              onClick={() => selectHotspot(hotspot.id)}
            />
          );
        })}
    </div>
  );

  return (
    <div ref={sectionRef} className="relative lg:flex lg:h-full lg:min-h-0 lg:flex-col">
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
        className={`relative mt-3 grid grid-cols-1 gap-6 lg:min-h-0 lg:flex-1 lg:overflow-hidden lg:p-1 ${revealed ? "mx-auto lg:mx-0 lg:grid-cols-[1.3fr_1fr] lg:gap-10" : "mx-auto max-w-2xl"}`}
      >
        {stage}

        {revealed && (
          // Ref target for the connector measurement — stays mounted
          // across both hotspot switches and the hint↔card swap so it's
          // never a stale/removed node when geometry is (re)computed.
          // Leave a one-step runway above the card: the connector traces its
          // top edge and the pulse needs unclipped space to remain legible.
          // This is on the measured wrapper, so both card height and SVG
          // geometry move together.
          <div ref={cardRef} data-testid="vehicle-card" className="min-h-[220px] lg:mt-4 lg:h-[calc(100%-1rem)] lg:min-h-0">
            <AnimatePresence mode="wait">
              {activeHotspot ? (
                <motion.div
                  key={activeHotspot.id}
                  initial={{ opacity: 0, x: shouldReduceMotion ? 0 : 16 }}
                  animate={{ opacity: isCardRevealed ? 1 : 0, x: isCardRevealed || shouldReduceMotion ? 0 : 16 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  aria-hidden={!isCardRevealed}
                  inert={!isCardRevealed}
                  className={`lg:h-full ${isCardRevealed ? "pointer-events-auto" : "pointer-events-none"}`}
                >
                  <ProductPanel
                    label={activeHotspot.label}
                    product={activeHotspot.product}
                    vehicleTypeSlug={activeEntry.vehicleType.slug}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="hint"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="flex min-h-[220px] flex-col justify-center gap-2 px-2 lg:min-h-0"
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
              className="pointer-events-none absolute inset-0 z-10 overflow-visible"
              width={svgSize.width}
              height={svgSize.height}
            >
              <Connector paths={activePaths} onConnected={() => revealCard(activeHotspotId!)} />
            </svg>
          )}
        </AnimatePresence>
      </div>

      {revealed && (
        <motion.div
          initial={{ scaleY: 0.4, opacity: 0 }}
          animate={{ scaleY: 1, opacity: 1 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.4, ease: [0.39, 0.575, 0.565, 1] }}
          className="mt-8 shrink-0 lg:mt-4"
        >
          <VehicleCarousel items={vehicleItems} activeIndex={activeVehicleIndex} onSelect={selectVehicle} />
        </motion.div>
      )}
    </div>
  );
}
