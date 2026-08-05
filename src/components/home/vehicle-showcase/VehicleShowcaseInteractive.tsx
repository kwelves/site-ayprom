"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { HotspotMarker } from "./HotspotMarker";
import { VehicleCarousel } from "./VehicleCarousel";
import { ProductPanel } from "./ProductPanel";
import { Connector } from "./Connector";
import { buildConnectorPaths, buildVerticalConnectorPath, type ConnectorPaths, type Rect } from "./connector-geometry";
import type { VehicleShowcaseEntry } from "@/lib/queries/vehicle-hotspots";

export interface VehicleVisual {
  image: string;
  aspectRatio: number;
}

interface VehicleShowcaseInteractiveProps {
  entries: VehicleShowcaseEntry[];
  visuals: Record<string, VehicleVisual>;
  defaultSlug: string;
}

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
  const [connected, setConnected] = useState(false);
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 });

  const activeEntry = entries[activeVehicleIndex];
  const activeHotspot = activeEntry?.hotspots.find((hotspot) => hotspot.id === activeHotspotId) ?? null;
  const visual = visuals[activeEntry?.vehicleType.slug ?? ""];

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
    setConnected(false);
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
      setConnected(false);
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
      entries.map((entry) => ({
        slug: entry.vehicleType.slug,
        name: entry.vehicleType.name,
        image: visuals[entry.vehicleType.slug]?.image ?? "",
      })),
    [entries, visuals],
  );

  if (!activeEntry || !visual) return null;

  const hotspotNumber = activeEntry.hotspots.length;

  return (
    <div ref={sectionRef} className="relative">
      <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{activeEntry.vehicleType.name}</p>

      {/* Always two columns on desktop — the right column shows a hint
          panel before any hotspot is picked and the product card after,
          rather than the grid itself growing a second column on first
          click. A layout that structurally changes shape (1→2 columns)
          mid-interaction was tried first and is the reason connector
          geometry kept measuring a mid-transition position; keeping the
          grid shape constant removes that whole class of bug. */}
      <div
        ref={containerRef}
        data-testid="vehicle-showcase-grid"
        className="relative mt-3 grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr] lg:items-center lg:gap-10"
      >
        <div className="relative">
          <div
            className="relative isolate w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0b1220]"
            style={{ aspectRatio: visual.aspectRatio }}
          >
            <Image
              src={visual.image}
              alt={activeEntry.vehicleType.name}
              fill
              sizes="(max-width: 1023px) 90vw, 55vw"
              priority
              className="object-cover"
            />

            {revealed &&
              activeEntry.hotspots.map((hotspot) => (
                <HotspotMarker
                  key={hotspot.id}
                  ref={(node) => {
                    if (node) hotspotRefs.current.set(hotspot.id, node);
                    else hotspotRefs.current.delete(hotspot.id);
                  }}
                  xPct={hotspot.xPct}
                  yPct={hotspot.yPct}
                  label={hotspot.label}
                  isActive={hotspot.id === activeHotspotId}
                  revealDelay={hotspot.hotspotNumber * 0.08}
                  onClick={() => selectHotspot(hotspot.id)}
                />
              ))}
          </div>

          {!isDesktop && verticalPath && activeHotspot && (
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute top-full left-0 -mt-px"
              width={svgSize.width}
              height={80}
              style={{ overflow: "visible" }}
            >
              <Connector paths={verticalPath} onConnected={() => setConnected(true)} />
            </svg>
          )}
        </div>

        {revealed && (
          // Ref target for the connector measurement — stays mounted across
          // both hotspot switches and the hint↔card swap so it's never a
          // stale/removed node when geometry is (re)computed.
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
                  <ProductPanel label={activeHotspot.label} product={activeHotspot.product} isConnected={connected} />
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
                    01—{String(hotspotNumber).padStart(2, "0")}
                  </p>
                  <p className="text-sm text-slate-400">
                    Нажмите на синий плюс, чтобы увидеть подходящее оборудование.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {isDesktop && connectorPaths && (
          <svg
            aria-hidden="true"
            data-testid="vehicle-connector-svg"
            className="pointer-events-none absolute inset-0 z-10"
            width={svgSize.width}
            height={svgSize.height}
          >
            <Connector paths={connectorPaths} onConnected={() => setConnected(true)} />
          </svg>
        )}
      </div>

      <AnimatePresence>
        {revealed && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="mt-8"
          >
            <VehicleCarousel items={vehicleItems} activeIndex={activeVehicleIndex} onSelect={selectVehicle} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
