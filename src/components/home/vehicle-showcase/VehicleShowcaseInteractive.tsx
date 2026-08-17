"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { HotspotMarker, type TooltipAlign } from "./HotspotMarker";
import { VehicleCarousel } from "./VehicleCarousel";
import { ProductPanel } from "./ProductPanel";
import { Connector } from "./Connector";
import { useContainRect } from "./useContainRect";
import { VehicleImageWarmup } from "./VehicleImageWarmup";
import { buildConnectorPaths, buildVerticalConnectorPath, type ConnectorPaths, type Rect } from "./connector-geometry";
import type { VehicleShowcaseEntry } from "@/lib/queries/vehicle-hotspots";
import { DURATION, EASE_UI } from "@/lib/motion";
import { useHomeEntrySequence } from "@/components/home/HomeEntrySequence";

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

/**
 * The background queue may only receive stage photos. Product previews are
 * loaded on demand by ProductPanel, so opening the site never warms a
 * hotspot's linked product image.
 */
export function collectVehicleImageWarmupCandidates(entries: VehicleShowcaseEntry[], visuals: Record<string, VehicleVisual>) {
  return entries.flatMap((entry) => {
    const candidateVisual = visuals[entry.vehicleType.slug];
    if (!candidateVisual) return [];
    return [{ slug: entry.vehicleType.slug, ...candidateVisual }];
  });
}

type VehicleTransitionPhase =
  | "idle"
  | "preloading"
  | "hotspots-exiting"
  | "vehicle-exiting"
  | "vehicle-entering"
  | "hotspots-entering";

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
  const { contentVisible } = useHomeEntrySequence();
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

  // The carousel can acknowledge a choice immediately while the stage keeps
  // rendering the previously displayed vehicle until the incoming large image
  // is decoded. Keeping those states separate prevents new geometry and
  // hotspots from briefly sitting over the old truck.
  const [selectedVehicleIndex, setSelectedVehicleIndex] = useState(defaultIndex);
  const [displayedVehicleIndex, setDisplayedVehicleIndex] = useState(defaultIndex);
  const [activeHotspotId, setActiveHotspotId] = useState<string | null>(null);
  const [isCardRevealed, setIsCardRevealed] = useState(false);
  const [entered, setEntered] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [firstViewSettled, setFirstViewSettled] = useState(false);
  const [initialVehicleReady, setInitialVehicleReady] = useState(false);
  const [transitionPhase, setTransitionPhase] = useState<VehicleTransitionPhase>("idle");
  const [showPreloadingIndicator, setShowPreloadingIndicator] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [connectorPaths, setConnectorPaths] = useState<ConnectorPaths | null>(null);
  const [verticalPath, setVerticalPath] = useState<{ stem: string; terminal: { x: number; y: number } } | null>(null);
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 });

  const transitionPhaseRef = useRef<VehicleTransitionPhase>("idle");
  const pendingVehicleIndexRef = useRef<number | null>(null);
  const switchingRef = useRef(false);

  const activeEntry = entries[displayedVehicleIndex];
  const activeHotspot = activeEntry?.hotspots.find((hotspot) => hotspot.id === activeHotspotId) ?? null;
  const visual = visuals[activeEntry?.vehicleType.slug ?? ""];
  const effectiveScale = isDesktop ? (visual?.desktopScale ?? visual?.scale ?? 1) : (visual?.scale ?? 1);
  const containRect = useContainRect(stageRef, visual?.naturalWidth ?? 1, visual?.naturalHeight ?? 1, effectiveScale);
  const pendingEntry = entries[selectedVehicleIndex];
  const pendingVisual = visuals[pendingEntry?.vehicleType.slug ?? ""];
  const pendingScale = isDesktop
    ? (pendingVisual?.desktopScale ?? pendingVisual?.scale ?? 1)
    : (pendingVisual?.scale ?? 1);
  const pendingContainRect = useContainRect(
    stageRef,
    pendingVisual?.naturalWidth ?? 1,
    pendingVisual?.naturalHeight ?? 1,
    pendingScale,
  );

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
    // The stage needs its revealed desktop layout before its measured image
    // rectangle exists. This proven initial beat keeps the vehicle first and
    // avoids waiting on an <Image> that is not mounted until that geometry is
    // available.
    const timer = setTimeout(() => setRevealed(true), shouldReduceMotion ? 0 : 700);
    return () => clearTimeout(timer);
  }, [entered, shouldReduceMotion]);

  useEffect(() => {
    // The idle queue may use an otherwise quiet main thread only after the
    // hero's own reveal has settled. If the showcase enters view, pause it
    // through the vehicle/hotspot choreography and resume once that scene
    // has completed too.
    if (!contentVisible || transitionPhase !== "idle" || (entered && !revealed)) {
      // Keep this out of the synchronous effect body: the derived `enabled`
      // expression below already blocks a same-frame warmup, while the
      // microtask resets the next settled scene's idle delay.
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setFirstViewSettled(false);
      });
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setTimeout(
      () => setFirstViewSettled(true),
      shouldReduceMotion ? 0 : (DURATION.reveal + DURATION.base) * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [contentVisible, entered, revealed, shouldReduceMotion, transitionPhase]);

  // A safety net for the rare cold request the static image warmup didn't
  // finish in time for: only surfaces after a short delay, so an ordinary
  // (now near-instant, pre-converted-image) switch never flashes it.
  useEffect(() => {
    if (transitionPhase !== "preloading") {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setShowPreloadingIndicator(false);
      });
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setTimeout(() => setShowPreloadingIndicator(true), 180);
    return () => window.clearTimeout(timer);
  }, [transitionPhase]);

  const clearConnector = () => {
    setConnectorPaths(null);
    setVerticalPath(null);
  };

  const startPreparedTransition = () => {
    if (transitionPhaseRef.current !== "preloading") return;

    transitionPhaseRef.current = "hotspots-exiting";
    activeHotspotIdRef.current = null;
    setActiveHotspotId(null);
    setIsCardRevealed(false);
    clearConnector();
    setTransitionPhase("hotspots-exiting");
  };

  // Selecting another vehicle is a short, locked state machine rather than a
  // single active-index update. The hidden <Image> below confirms the exact
  // large source is ready before this transition starts.
  const selectVehicle = (index: number) => {
    if (switchingRef.current || index === selectedVehicleIndex) return;

    switchingRef.current = true;
    pendingVehicleIndexRef.current = index;
    transitionPhaseRef.current = "preloading";
    setSelectedVehicleIndex(index);
    setTransitionPhase("preloading");
  };

  useEffect(() => {
    if (transitionPhase !== "hotspots-exiting") return;
    const timer = window.setTimeout(
      () => {
        transitionPhaseRef.current = "vehicle-exiting";
        setTransitionPhase("vehicle-exiting");
      },
      shouldReduceMotion ? 0 : DURATION.base * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [shouldReduceMotion, transitionPhase]);

  useEffect(() => {
    if (transitionPhase !== "hotspots-entering") return;
    const finalHotspotDelay = Math.max(0, ...activeEntry.hotspots.map((hotspot) => hotspot.hotspotNumber * 80));
    const timer = window.setTimeout(
      () => {
        transitionPhaseRef.current = "idle";
        pendingVehicleIndexRef.current = null;
        switchingRef.current = false;
        setTransitionPhase("idle");
      },
      shouldReduceMotion ? 0 : DURATION.base * 1000 + finalHotspotDelay,
    );
    return () => window.clearTimeout(timer);
  }, [activeEntry.hotspots, shouldReduceMotion, transitionPhase]);

  const completeVehicleExit = () => {
    if (transitionPhaseRef.current !== "vehicle-exiting") return;
    const nextIndex = pendingVehicleIndexRef.current;
    if (nextIndex === null) return;

    setDisplayedVehicleIndex(nextIndex);
    if (shouldReduceMotion) {
      transitionPhaseRef.current = "hotspots-entering";
      setTransitionPhase("hotspots-entering");
      return;
    }

    transitionPhaseRef.current = "vehicle-entering";
    setTransitionPhase("vehicle-entering");
  };

  const completeVehicleEnter = () => {
    if (transitionPhaseRef.current !== "vehicle-entering") return;
    transitionPhaseRef.current = "hotspots-entering";
    setTransitionPhase("hotspots-entering");
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
  const imageWarmupCandidates = useMemo(() => collectVehicleImageWarmupCandidates(entries, visuals), [entries, visuals]);

  if (!activeEntry || !visual) return null;

  const hotspotCount = activeEntry.hotspots.length;
  const activePaths = connectorPaths ?? verticalPath;
  const hotspotsVisible =
    transitionPhase !== "hotspots-exiting" &&
    transitionPhase !== "vehicle-exiting" &&
    transitionPhase !== "vehicle-entering";
  const switchingHotspots = transitionPhase === "hotspots-exiting" || transitionPhase === "hotspots-entering";

  const stage = (
    <div ref={stageRef} className={`relative w-full lg:overflow-hidden ${STAGE_ASPECT_CLASS}`}>
      {contentVisible && containRect.width > 0 && (
        // Not `fill` — `scale` on VehicleVisual can push the photo past
        // strict contain-fit on purpose, and `fill` always clamps to the
        // parent box. Explicit width/height (from the same scaled rect
        // hotspots use) lets it actually overflow; `max-w-none` beats
        // the global img{max-width:100%} reset that would otherwise shrink
        // it straight back down.
        <AnimatePresence mode="wait" initial={false} onExitComplete={completeVehicleExit}>
          {transitionPhase !== "vehicle-exiting" && (
            <motion.div
              key={activeEntry.vehicleType.slug}
              initial={
                transitionPhase === "vehicle-entering" && !shouldReduceMotion
                  ? { opacity: 0, scale: 0.96 }
                  : false
              }
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.96 }}
              transition={{ duration: shouldReduceMotion ? 0 : DURATION.base, ease: EASE_UI }}
              onAnimationComplete={completeVehicleEnter}
              className="pointer-events-none absolute inset-0"
            >
              <Image
                src={visual.image}
                alt={activeEntry.vehicleType.name}
                width={Math.round(containRect.width)}
                height={Math.round(containRect.height)}
                // These five vehicle photos are pre-converted static .webp
                // files (see scripts/generate-vehicle-webp.mjs), so skipping
                // next/image's on-demand optimizer avoids the per-request
                // resize+encode cost that made a fresh (vehicle, width) pair
                // slower to first request than a cached one.
                unoptimized
                loading="eager"
                onLoad={() => {
                  if (activeEntry.vehicleType.slug === entries[defaultIndex]?.vehicleType.slug) setInitialVehicleReady(true);
                }}
                onError={() => {
                  // A missing non-critical image must not keep the rest of
                  // the idle queue behind a perpetual loading state.
                  if (activeEntry.vehicleType.slug === entries[defaultIndex]?.vehicleType.slug) setInitialVehicleReady(true);
                }}
                className="absolute max-w-none"
                style={{ left: containRect.left, top: containRect.top, width: containRect.width, height: containRect.height }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Uses the same responsive Image source as the visible stage, but is
          transparent. Its completed request is the permission to begin the
          outgoing animation, so a slow image can never expose new hotspots
          over the old vehicle. */}
      {transitionPhase === "preloading" && pendingVisual && pendingContainRect.width > 0 && (
        <Image
          src={pendingVisual.image}
          alt=""
          aria-hidden="true"
          width={Math.round(pendingContainRect.width)}
          height={Math.round(pendingContainRect.height)}
          unoptimized
          loading="eager"
          onLoad={startPreparedTransition}
          onError={startPreparedTransition}
          className="pointer-events-none absolute max-w-none opacity-0"
          style={{ left: pendingContainRect.left, top: pendingContainRect.top, width: pendingContainRect.width, height: pendingContainRect.height }}
        />
      )}

      {/* Only for the rare cold path the static-file switch didn't avoid —
          a visible sign the switch is in progress instead of a frozen-looking
          stage. Delayed mount (see the effect above) keeps it from flashing
          on the now-typical instant switch. */}
      {showPreloadingIndicator && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" role="status" aria-live="polite">
          <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin text-white/70" />
          <span className="sr-only">Загрузка техники</span>
        </div>
      )}

      <VehicleImageWarmup
        candidates={imageWarmupCandidates}
        defaultSlug={entries[defaultIndex]?.vehicleType.slug ?? defaultSlug}
        enabled={firstViewSettled && initialVehicleReady && transitionPhase === "idle" && (!entered || revealed)}
      />

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
              visible={hotspotsVisible}
              switching={switchingHotspots}
              disabled={transitionPhase !== "idle"}
              onClick={() => {
                if (transitionPhase === "idle") selectHotspot(hotspot.id);
              }}
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
          <VehicleCarousel
            items={vehicleItems}
            activeIndex={selectedVehicleIndex}
            disabled={transitionPhase !== "idle"}
            onSelect={selectVehicle}
          />
        </motion.div>
      )}
    </div>
  );
}
