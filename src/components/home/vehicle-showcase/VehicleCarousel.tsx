"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion, type PanInfo } from "framer-motion";

const SWIPE_THRESHOLD = 40;
// How many slots are visible on each side of the active one. With 5 real
// vehicles this exactly covers all of them (0 = active, ±1 = near, ±2 =
// the ones fading into the edge) — no vehicle is ever rendered twice.
const BUFFER = 2;

interface VehicleCarouselItem {
  slug: string;
  name: string;
  image: string;
}

interface VehicleCarouselProps {
  items: VehicleCarouselItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

interface Slot {
  key: number;
  semanticIndex: number;
  position: number;
}

function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

function buildInitialSlots(activeIndex: number, count: number): Slot[] {
  const slots: Slot[] = [];
  for (let position = -BUFFER; position <= BUFFER; position++) {
    slots.push({ key: position, semanticIndex: mod(activeIndex + position, count), position });
  }
  return slots;
}

/**
 * Shifts every existing slot by `-delta` and fills in whatever positions
 * that leaves empty at the edges — the belt-conveyor version of a carousel:
 * a slot's `key` (and DOM node) survives as long as it stays within the
 * visible window, so Framer animates its `x` smoothly to the new slot; only
 * the item(s) actually entering the window are freshly mounted (fading in
 * at the edge, already blurred there — never a "flies in from the opposite
 * side" jump, which is what a circular-shortest-distance layout gives you).
 */
function shiftSlots(prevSlots: Slot[], delta: number, newActiveIndex: number, count: number, nextKeyRef: { current: number }): Slot[] {
  const shifted = prevSlots
    .map((slot) => ({ ...slot, position: slot.position - delta }))
    .filter((slot) => Math.abs(slot.position) <= BUFFER);
  const covered = new Set(shifted.map((slot) => slot.position));
  const filled = [...shifted];
  for (let position = -BUFFER; position <= BUFFER; position++) {
    if (covered.has(position)) continue;
    filled.push({ key: nextKeyRef.current++, semanticIndex: mod(newActiveIndex + position, count), position });
  }
  return filled;
}

export function VehicleCarousel({ items, activeIndex, onSelect }: VehicleCarouselProps) {
  const maskRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const didDragRef = useRef(false);
  const nextKeyRef = useRef(BUFFER + 1);
  const [isDragging, setIsDragging] = useState(false);
  const [slotWidth, setSlotWidth] = useState(220);
  const [slots, setSlots] = useState<Slot[]>(() => buildInitialSlots(activeIndex, items.length));

  useLayoutEffect(() => {
    const box = maskRef.current;
    if (!box) return;
    const compute = () => setSlotWidth(box.clientWidth / (BUFFER * 2 + 1));
    compute();
    const resizeObserver = new ResizeObserver(compute);
    resizeObserver.observe(box);
    return () => resizeObserver.disconnect();
  }, []);

  const navigate = (delta: number, newActiveIndex: number) => {
    setSlots((prev) => shiftSlots(prev, delta, newActiveIndex, items.length, nextKeyRef));
    onSelect(newActiveIndex);
  };

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setIsDragging(false);
    if (info.offset.x < -SWIPE_THRESHOLD) {
      navigate(1, mod(activeIndex + 1, items.length));
    } else if (info.offset.x > SWIPE_THRESHOLD) {
      navigate(-1, mod(activeIndex - 1, items.length));
    }
    requestAnimationFrame(() => {
      didDragRef.current = false;
    });
  };

  return (
    <div className="mx-auto max-w-4xl rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-8 sm:px-8">
      {/* Edge-fade mask: items dissolve into the container edge instead of
          being hard-clipped or (the thing we're avoiding) visibly flying in
          from the opposite side. */}
      <div
        ref={maskRef}
        className="relative h-40 overflow-hidden sm:h-48"
        style={{
          maskImage: "linear-gradient(to right, transparent, black 14%, black 86%, transparent)",
          WebkitMaskImage: "linear-gradient(to right, transparent, black 14%, black 86%, transparent)",
        }}
      >
        {/* Fixed, always-on indicator — center-anchored regardless of which
            vehicle is active, never unmounted. Only two states: lit
            (default) and dimmed while the strip is being dragged. The
            thumbnails below are bottom-anchored (not vertically centered)
            precisely so there's a deliberate, consistent gap between them
            and this lamp rather than the truck sitting flush on top of it. */}
        <ActiveLamp isDragging={isDragging} />

        <motion.div
          ref={trackRef}
          className="absolute inset-0 touch-pan-y"
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.15}
          onDragStart={() => {
            didDragRef.current = true;
            setIsDragging(true);
          }}
          onDragEnd={handleDragEnd}
        >
          {[...slots].sort((a, b) => a.position - b.position).map((slot) => {
            const item = items[slot.semanticIndex];
            const distance = Math.abs(slot.position);
            const isActive = distance === 0;
            const isNear = distance === 1;

            return (
              <motion.button
                key={slot.key}
                type="button"
                onClick={() => {
                  if (!didDragRef.current && slot.position !== 0) navigate(slot.position, slot.semanticIndex);
                }}
                aria-label={item.name}
                aria-current={isActive}
                className="absolute bottom-9 left-1/2 h-24 w-44 -translate-x-1/2 outline-none sm:bottom-11 sm:h-28 sm:w-56"
                initial={{ x: slot.position * slotWidth, opacity: 0 }}
                animate={{
                  x: slot.position * slotWidth,
                  opacity: isActive || isNear ? 1 : 0.22,
                  scale: isActive ? 1 : isNear ? 0.82 : 0.62,
                  filter: isActive ? "brightness(1) blur(0px)" : isNear ? "brightness(0.87) blur(0px)" : "brightness(0.7) blur(4px)",
                }}
                transition={{ type: "spring", stiffness: 260, damping: 30 }}
              >
                <Image src={item.image} alt="" fill sizes="256px" className="object-contain" draggable={false} />
              </motion.button>
            );
          })}
        </motion.div>
      </div>
    </div>
  );
}

// Fixed LED-rail indicator, center-anchored under the strip — not tied to
// any one thumbnail's artwork, never unmounted. Three layers, exactly per
// spec: a crisp white core (linear-gradient bar), a tight near-glow
// (box-shadow), and a wide soft radial wash that reaches upward toward the
// vehicle sitting above it — that wash is what visually "touches" and
// lights the truck; the core bar itself stays a thin, sharp line with real
// air between it and the artwork. Two states only — lit (default) and off
// while the strip is being dragged — both driven by one boolean, nothing
// about the lamp itself ever unmounts.
function ActiveLamp({ isDragging }: { isDragging: boolean }) {
  return (
    // Positioning (bottom + horizontal centering) lives on this plain,
    // non-animated span. Framer writes its own inline `transform` for
    // scaleX below — on the *same* element that would silently replace
    // (not merge with) a `-translate-x-1/2` class's transform, since
    // inline style always wins over a stylesheet rule for one CSS
    // property. Same class of bug as the hotspot entrance animation, same
    // fix: keep the class-based transform and the framer-animated
    // transform on two different elements.
    <span aria-hidden="true" className="pointer-events-none absolute bottom-2 left-1/2 z-0 h-1 w-[120px] -translate-x-1/2 rounded-full">
      <motion.span
        className="absolute inset-0 rounded-full"
        style={{
          background: "linear-gradient(90deg, transparent 0%, #dceeff 10%, #ffffff 50%, #dceeff 90%, transparent 100%)",
          boxShadow: "0 0 5px rgba(255,255,255,0.95), 0 0 12px rgba(103,181,255,0.75), 0 0 24px rgba(43,135,255,0.45)",
          isolation: "isolate",
        }}
        initial={false}
        animate={{ opacity: isDragging ? 0 : 1, scaleX: isDragging ? 0.35 : 1 }}
        transition={{ opacity: { duration: 0.28 }, scaleX: { duration: 0.48, ease: [0.22, 1, 0.36, 1] } }}
      />
      {/* Wide soft upward wash — the ::before equivalent from spec. Not
          animated, so no transform-precedence conflict here; it just fades
          with its parent's opacity via CSS. */}
      <span
        className="pointer-events-none absolute -bottom-[5px] left-1/2 -z-10 h-[70px] w-[190px] -translate-x-1/2 transition-opacity duration-300"
        style={{
          background: "radial-gradient(ellipse at 50% 100%, rgba(92,169,255,0.38) 0%, rgba(66,145,255,0.17) 35%, transparent 72%)",
          filter: "blur(10px)",
          opacity: isDragging ? 0 : 1,
        }}
      />
    </span>
  );
}
