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
import {
  calculateHotspotLayoutMetrics,
  createFallbackHotspotMetrics,
  resolveHotspotPositions,
} from "./showcase-layout";
import type { VehicleShowcaseEntry } from "@/lib/queries/vehicle-hotspots";
import { DURATION, EASE_UI } from "@/lib/motion";
import { useHomeEntrySequence } from "@/components/home/HomeEntrySequence";

export interface VehicleVisual {
  image: string;
  /** Smaller pre-built variant for viewports below the `lg` breakpoint (see
   * scripts/generate-vehicle-webp.mjs's `-mobile.webp` output). The stage
   * shows the photo noticeably smaller there, so the full-resolution file is
   * wasted bytes — falls back to `image` when absent. `naturalWidth`/
   * `naturalHeight` below describe the source crop's aspect ratio only, not
   * which file is fetched, so they stay the same regardless of this pick. */
  imageMobile?: string;
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

// Per-(vehicle, hotspot NUMBER) tooltip placement, keyed because the generic
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
// Самосвал's hotspot 5 ("Гидробак за кабиной" at the time of measurement)
// always touches hotspot 4 ("Распределитель") — their circles sit under one
// diameter apart — and Тонар's hotspot 3 ("Гидронасос" at measurement time)
// sits low enough on the truck that flipping it to `below` avoids every
// neighbor but clips the *grid's* `lg:overflow-hidden` bottom edge
// instead — a container clip that z-30 can't rescue, unlike a same-level
// sibling overlap, so `below: false` (overlaps 4 neighbors, 0 clip) beats
// `below: true` (0 overlaps, clips) here. HotspotMarker's hover/active
// z-30 is the backstop for both overlap cases, so the tooltip you're
// pointing at always paints over the marker(s) it still overlaps.
//
// Keyed by hotspot_number (not label text): position/numbering never change
// for a given vehicle type (admin can only rename the label, see
// vehicle-showcase admin), so the number is a stable key while the label is
// not — a rename in the admin must not desync this table.
const TOOLTIP_PLACEMENT: Record<string, TooltipPlacement> = {
  "kran-manipulyator:1": { below: false, align: "center" },
  "kran-manipulyator:2": { below: true, align: "center", gap: 16 },
  "kran-manipulyator:3": { below: true, align: "center" },
  "kran-manipulyator:4": { below: false, align: "center" },
  "kran-manipulyator:5": { below: false, align: "center" },

  "musorovoz:1": { below: false, align: "center" },
  "musorovoz:2": { below: false, align: "center" },
  "musorovoz:3": { below: true, align: "center" },
  "musorovoz:4": { below: false, align: "center" },
  "musorovoz:5": { below: false, align: "center" },

  "samosval:1": { below: true, align: "center" },
  "samosval:2": { below: true, align: "center", gap: 32 },
  "samosval:3": { below: false, align: "end" },
  "samosval:4": { below: false, align: "center" },
  "samosval:5": { below: false, align: "start" },

  "tyagach:1": { below: false, align: "start" },
  "tyagach:2": { below: false, align: "center" },
  "tyagach:3": { below: false, align: "center" },
  "tyagach:4": { below: false, align: "center", gap: 24 },
  "tyagach:5": { below: true, align: "center", gap: 16 },

  "avtovoz:1": { below: true, align: "center" },
  "avtovoz:2": { below: true, align: "center" },
  "avtovoz:3": { below: true, align: "center" },
  "avtovoz:4": { below: false, align: "center" },
  "avtovoz:5": { below: false, align: "center" },
};

interface VehicleShowcaseInteractiveProps {
  entries: VehicleShowcaseEntry[];
  visuals: Record<string, VehicleVisual>;
  defaultSlug: string;
}

/** Picks the file actually worth fetching for the current breakpoint — see
 * `VehicleVisual.imageMobile`. */
function pickVisualImage(visual: VehicleVisual, isDesktop: boolean): string {
  return isDesktop ? visual.image : (visual.imageMobile ?? visual.image);
}

/**
 * The background queue may only receive stage photos. Product previews are
 * loaded on demand by ProductPanel, so opening the site never warms a
 * hotspot's linked product image.
 */
export function collectVehicleImageWarmupCandidates(
  entries: VehicleShowcaseEntry[],
  visuals: Record<string, VehicleVisual>,
  isDesktop: boolean,
) {
  return entries.flatMap((entry) => {
    const candidateVisual = visuals[entry.vehicleType.slug];
    if (!candidateVisual) return [];
    return [{ slug: entry.vehicleType.slug, ...candidateVisual, image: pickVisualImage(candidateVisual, isDesktop) }];
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
  // Which vehicle the hidden probe <Image> below is currently confirming is
  // ready. Only meaningful during "preloading" — separate from
  // `selectedVehicleIndex` (which the carousel highlight follows on every
  // click, even mid-transition) so a rapid re-click can retarget the probe
  // without touching whatever the visible stage is already committed to.
  const [preloadTargetIndex, setPreloadTargetIndex] = useState<number | null>(null);
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
  // The single most recent choice, updated on every click regardless of
  // what's currently in flight — the source of truth for "what should
  // eventually be on screen."
  const desiredVehicleIndexRef = useRef(defaultIndex);
  // What the *currently in-flight* exit/enter cycle is committed to
  // displaying, once its probe image has actually confirmed ready.
  // Immutable for the rest of that one cycle — see completeVehicleExit.
  const committedTargetRef = useRef<number | null>(null);

  const activeEntry = entries[displayedVehicleIndex];
  const activeHotspot = activeEntry?.hotspots.find((hotspot) => hotspot.id === activeHotspotId) ?? null;
  const visual = visuals[activeEntry?.vehicleType.slug ?? ""];
  const effectiveScale = isDesktop ? (visual?.desktopScale ?? visual?.scale ?? 1) : (visual?.scale ?? 1);
  const containRect = useContainRect(stageRef, visual?.naturalWidth ?? 1, visual?.naturalHeight ?? 1, effectiveScale);
  const hotspotAnchorPoints = useMemo(
    () =>
      activeEntry?.hotspots.map((hotspot) => ({
        id: hotspot.id,
        x: containRect.left + (hotspot.xPct / 100) * containRect.width,
        y: containRect.top + (hotspot.yPct / 100) * containRect.height,
      })) ?? [],
    [activeEntry, containRect.height, containRect.left, containRect.top, containRect.width],
  );
  const hotspotLayoutMetrics = useMemo(() => {
    return calculateHotspotLayoutMetrics(containRect.width, hotspotAnchorPoints);
  }, [containRect.width, hotspotAnchorPoints]);
  const hotspotPositions = useMemo(() => {
    return resolveHotspotPositions(hotspotAnchorPoints, hotspotLayoutMetrics);
  }, [hotspotAnchorPoints, hotspotLayoutMetrics]);
  const preloadEntry = preloadTargetIndex !== null ? entries[preloadTargetIndex] : undefined;
  const preloadVisual = visuals[preloadEntry?.vehicleType.slug ?? ""];
  const preloadScale = isDesktop
    ? (preloadVisual?.desktopScale ?? preloadVisual?.scale ?? 1)
    : (preloadVisual?.scale ?? 1);
  const preloadContainRect = useContainRect(
    stageRef,
    preloadVisual?.naturalWidth ?? 1,
    preloadVisual?.naturalHeight ?? 1,
    preloadScale,
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
    if (transitionPhaseRef.current !== "preloading" || preloadTargetIndex === null) return;

    // The point of no return for this cycle: once its probe image has
    // confirmed ready, what gets displayed is locked in, even if the user
    // keeps clicking around while it plays out.
    committedTargetRef.current = preloadTargetIndex;
    transitionPhaseRef.current = "hotspots-exiting";
    activeHotspotIdRef.current = null;
    setActiveHotspotId(null);
    setIsCardRevealed(false);
    clearConnector();
    setTransitionPhase("hotspots-exiting");
  };

  const beginPreload = (index: number) => {
    transitionPhaseRef.current = "preloading";
    setTransitionPhase("preloading");
    setPreloadTargetIndex(index);
  };

  // Selecting another vehicle never waits for the carousel to go quiet
  // first — every click is acknowledged immediately. The hidden <Image>
  // below still confirms the exact large source is ready before anything
  // visible changes; a click that lands mid-animation is remembered and
  // chained in automatically once the vehicle already in flight finishes,
  // rather than interrupting a cycle whose image is already committed and
  // showing (see the "hotspots-entering" effect below).
  const selectVehicle = (index: number) => {
    if (index === desiredVehicleIndexRef.current) return;
    desiredVehicleIndexRef.current = index;
    setSelectedVehicleIndex(index);

    if (transitionPhaseRef.current === "idle") {
      beginPreload(index);
      return;
    }

    if (transitionPhaseRef.current === "preloading") {
      if (index === displayedVehicleIndex) {
        // Changed their mind back to what's already on screen — cancel the
        // in-flight probe instead of loading it just to throw it away.
        setPreloadTargetIndex(null);
        transitionPhaseRef.current = "idle";
        setTransitionPhase("idle");
        return;
      }
      setPreloadTargetIndex(index);
      return;
    }

    // Any later phase (hotspots-exiting … hotspots-entering): recorded via
    // desiredVehicleIndexRef only. That cycle's committed target already
    // has a confirmed-loaded image and is mid-animation — interrupting it
    // risks showing an unconfirmed image, so it finishes normally instead.
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
        committedTargetRef.current = null;
        const desired = desiredVehicleIndexRef.current;
        if (desired !== displayedVehicleIndex) {
          // A newer click landed while this cycle's hotspots were still
          // settling in — chain straight into it instead of dropping back
          // to idle first, so that click never gets silently dropped.
          beginPreload(desired);
          return;
        }
        transitionPhaseRef.current = "idle";
        setTransitionPhase("idle");
      },
      shouldReduceMotion ? 0 : DURATION.base * 1000 + finalHotspotDelay,
    );
    return () => window.clearTimeout(timer);
  }, [activeEntry.hotspots, displayedVehicleIndex, shouldReduceMotion, transitionPhase]);

  const completeVehicleExit = () => {
    if (transitionPhaseRef.current !== "vehicle-exiting") return;
    const nextIndex = committedTargetRef.current;
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
    const activeMetrics = hotspotLayoutMetrics.get(activeHotspotId) ?? createFallbackHotspotMetrics();

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
        setConnectorPaths(buildConnectorPaths(hotspotRect, activeMetrics.visualDiameter / 2, cardRect, obstacles));
        setVerticalPath(null);
      } else {
        setVerticalPath(buildVerticalConnectorPath(hotspotRect, activeMetrics.visualDiameter / 2, cardRect));
        setConnectorPaths(null);
      }
    };

    compute();
    const resizeObserver = new ResizeObserver(compute);
    resizeObserver.observe(container);
    resizeObserver.observe(cardEl);
    return () => resizeObserver.disconnect();
  }, [activeHotspotId, activeEntry, hotspotLayoutMetrics, isDesktop]);

  const vehicleItems = useMemo(
    () =>
      entries.map((entry) => ({
        slug: entry.vehicleType.slug,
        name: entry.vehicleType.name,
        image: visuals[entry.vehicleType.slug]?.image ?? "",
      })),
    [entries, visuals],
  );
  const imageWarmupCandidates = useMemo(
    () => collectVehicleImageWarmupCandidates(entries, visuals, isDesktop),
    [entries, visuals, isDesktop],
  );

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
                src={pickVisualImage(visual, isDesktop)}
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

      {/* Uses the same source as the visible stage, but is transparent. Its
          completed request is the permission to begin the outgoing
          animation, so a slow image can never expose new hotspots over the
          old vehicle. Re-clicking during "preloading" retargets this same
          probe (its src just changes) rather than mounting a second one. */}
      {transitionPhase === "preloading" && preloadVisual && preloadContainRect.width > 0 && (
        <Image
          src={pickVisualImage(preloadVisual, isDesktop)}
          alt=""
          aria-hidden="true"
          width={Math.round(preloadContainRect.width)}
          height={Math.round(preloadContainRect.height)}
          unoptimized
          loading="eager"
          onLoad={startPreparedTransition}
          onError={startPreparedTransition}
          className="pointer-events-none absolute max-w-none opacity-0"
          style={{ left: preloadContainRect.left, top: preloadContainRect.top, width: preloadContainRect.width, height: preloadContainRect.height }}
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
          const position = hotspotPositions.get(hotspot.id);
          const left = position?.x ?? containRect.left + (hotspot.xPct / 100) * containRect.width;
          const top = position?.y ?? containRect.top + (hotspot.yPct / 100) * containRect.height;
          // Falls back to the generic edge-based heuristic for any hotspot
          // not in the table (new DB data before it's been measured/added).
          const placement = TOOLTIP_PLACEMENT[`${activeEntry.vehicleType.slug}:${hotspot.hotspotNumber}`];
          const tooltipBelow = placement?.below ?? top < containRect.boxHeight * 0.2;
          const tooltipAlign = placement?.align ?? (left < containRect.boxWidth * 0.25 ? "start" : left > containRect.boxWidth * 0.75 ? "end" : "center");
          const metrics = hotspotLayoutMetrics.get(hotspot.id) ?? createFallbackHotspotMetrics();
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
              metrics={metrics}
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
    <div ref={sectionRef} className="relative lg:flex lg:flex-1 lg:flex-col">
      <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{activeEntry.vehicleType.name}</p>

      {/* The final grid exists from the first render. The previous entrance
          changed from one column to two and mounted the card 700ms after the
          section entered the viewport; that pushed every following section
          down and produced the production CLS spike. The choreography now
          changes only opacity/scale while these boxes keep their final size.
          `stage` also stays at the same tree position so useContainRect's
          ResizeObserver remains attached. */}
      <div
        ref={containerRef}
        data-testid="vehicle-showcase-grid"
        className="relative mx-auto mt-3 grid grid-cols-1 gap-6 lg:mx-0 lg:flex-1 lg:grid-cols-[1.3fr_1fr] lg:gap-10 lg:p-1"
      >
        {stage}

        <div
          ref={cardRef}
          data-testid="vehicle-card"
          aria-hidden={!revealed}
          inert={!revealed}
          className={`min-h-[220px] transition-opacity duration-reveal ease-ui lg:mt-4 lg:min-h-[29rem] ${
            revealed ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          {/* Ref target for the connector measurement — stays mounted across
              hotspot switches and the hint↔card swap. The reserved height is
              shared by the card and connector geometry. */}
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
                className={`lg:min-h-[29rem] ${isCardRevealed ? "pointer-events-auto" : "pointer-events-none"}`}
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

      <div
        aria-hidden={!revealed}
        inert={!revealed}
        className={`mt-8 shrink-0 origin-top transition-[opacity,scale] duration-reveal ease-ui lg:mt-4 ${
          revealed ? "scale-y-100 opacity-100" : "pointer-events-none scale-y-[0.4] opacity-0"
        }`}
      >
        {/* No longer gated on transitionPhase !== "idle": every click is
            acknowledged immediately (see selectVehicle above) instead of
            being dropped while a previous switch is still animating. */}
        <VehicleCarousel items={vehicleItems} activeIndex={selectedVehicleIndex} onSelect={selectVehicle} />
      </div>
    </div>
  );
}
