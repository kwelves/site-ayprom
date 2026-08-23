"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion, type PanInfo } from "framer-motion";
import { CarouselLamp } from "./CarouselLamp";

const SWIPE_THRESHOLD = 40;
// How many slots are visible on each side of the active one. With 5 real
// vehicles this exactly covers all of them (0 = active, ±1 = near, ±2 =
// the ones fading into the edge) — no vehicle is ever rendered twice.
const BUFFER = 2;

// Per-vehicle lg-only correction so every thumbnail grows ~35-40% while
// landing on the *same* 10px gap between wheel-base and the lamp's bright
// core line (CarouselLamp.tsx: `bottom-2` + `h-[2px]`, so that line's top
// edge sits 10px above this button's own bottom-0), despite each PNG
// having a different amount of transparent margin below its wheels. Each
// source photo was measured with a canvas alpha-channel scan (bottom-most
// non-transparent pixel row, as a fraction of image height) at the
// thumbnail's lg box height (64px):
//   kran-manipulyator 0.2514  musorovoz 0.2982  avtovoz 0.3052
//   samosval 0.2244            tyagach 0.1657
// `scale` is applied from a bottom-center origin (`origin-bottom`), so it
// grows the photo without moving its bottom edge; `translateY` then places
// the wheel-base 20px above bottom-0 — 10px of that is the lamp line's own
// height above bottom-0, the other 10px is the actual visible gap:
//   translateY = fBottom × 64 × scale − 20
// Verified in-browser (measured wheel-bottom vs. the lamp line's actual
// getBoundingClientRect, not just the math) — see conversation history.
// Lives on an inner wrapper, not the <Image> itself or the outer
// motion.button — the button already carries Framer's own animated
// `scale` for the near/far depth effect, and an inline `transform` from
// Framer would silently overwrite (not merge with) a class-based one on
// the same element (see HotspotMarker's entrance-animation comment for the
// same class of bug).
const CAROUSEL_LG_VISUAL: Record<string, string> = {
  "kran-manipulyator": "lg:origin-bottom lg:scale-[1.375] lg:translate-y-[2.1px]",
  musorovoz: "lg:origin-bottom lg:scale-[1.375] lg:translate-y-[6.2px]",
  avtovoz: "lg:origin-bottom lg:scale-[1.375] lg:translate-y-[6.9px]",
  samosval: "lg:origin-bottom lg:scale-[1.375] lg:translate-y-[-0.3px]",
  tyagach: "lg:origin-bottom lg:scale-[1.375] lg:translate-y-[-5.4px]",
};

interface VehicleCarouselItem {
  slug: string;
  name: string;
  image: string;
}

interface VehicleCarouselProps {
  items: VehicleCarouselItem[];
  activeIndex: number;
  disabled?: boolean;
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
 * This is what makes the strip infinite in both directions: there is no
 * start/end index, only positions relative to whatever is active.
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

export function VehicleCarousel({ items, activeIndex, disabled = false, onSelect }: VehicleCarouselProps) {
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
    if (disabled) return;
    setSlots((prev) => shiftSlots(prev, delta, newActiveIndex, items.length, nextKeyRef));
    onSelect(newActiveIndex);
  };

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setIsDragging(false);
    if (disabled) return;
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
    <div className="relative mx-auto w-full max-w-4xl">
      {/* Edge-fade mask: items dissolve into the container edge instead of
          being hard-clipped or (the thing we're avoiding) visibly flying in
          from the opposite side. */}
      <div
        ref={maskRef}
        className="relative z-10 h-20 overflow-hidden sm:h-24 lg:h-28"
        style={{
          maskImage: "linear-gradient(to right, transparent, black 14%, black 86%, transparent)",
          WebkitMaskImage: "linear-gradient(to right, transparent, black 14%, black 86%, transparent)",
        }}
      >
        <motion.div
          ref={trackRef}
          className="absolute inset-0 touch-pan-y"
          drag={disabled ? false : "x"}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.15}
          onDragStart={() => {
            if (disabled) return;
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
                disabled={disabled}
                onClick={() => {
                  if (!disabled && !didDragRef.current && slot.position !== 0) {
                    navigate(slot.position, slot.semanticIndex);
                  }
                }}
                aria-label={item.name}
                aria-current={isActive}
                className="absolute bottom-0 left-1/2 h-[77px] w-[134px] -translate-x-1/2 outline-none disabled:cursor-wait sm:h-20 sm:w-32 lg:h-16 lg:w-28"
                initial={{ x: slot.position * slotWidth, opacity: 0 }}
                animate={{
                  x: slot.position * slotWidth,
                  opacity: isActive || isNear ? 1 : 0.75,
                  scale: isActive ? 1 : isNear ? 0.82 : 0.62,
                  filter: isActive ? "brightness(1) blur(0px)" : isNear ? "brightness(0.87) blur(0px)" : "brightness(0.95) blur(0.4px)",
                }}
                transition={{ type: "spring", stiffness: 260, damping: 30 }}
              >
                <div className={`relative h-full w-full ${CAROUSEL_LG_VISUAL[item.slug] ?? ""}`}>
                  <Image src={item.image} alt="" fill sizes="256px" className="object-contain" draggable={false} />
                </div>
              </motion.button>
            );
          })}
        </motion.div>
      </div>

      {/* Pinned to the carousel container's own bottom-center, independent
          of the mask above — its glow sits behind the thumbnails (z-0 vs.
          the mask's z-10) and isn't edge-faded or clipped with them. */}
      {/* The lamp is pinned to the center and stays visually continuous while
          thumbnails move past it. Only an actual drag dims it; click-driven
          switches must not blink the fixed selection landmark. */}
      <CarouselLamp dimmed={isDragging} />
    </div>
  );
}
