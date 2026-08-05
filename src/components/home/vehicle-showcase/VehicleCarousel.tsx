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
        className="relative h-48 overflow-hidden sm:h-56"
        style={{
          maskImage: "linear-gradient(to right, transparent, black 14%, black 86%, transparent)",
          WebkitMaskImage: "linear-gradient(to right, transparent, black 14%, black 86%, transparent)",
        }}
      >
        {/* Fixed, always-on indicator — center-anchored regardless of which
            vehicle is active, never unmounted. Only two states: lit
            (default) and dimmed while the strip is being dragged. Sits a
            clear gap below the artwork, not flush against it. */}
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
                className="absolute top-1/2 left-1/2 h-28 w-48 -translate-x-1/2 -translate-y-1/2 outline-none sm:h-32 sm:w-64"
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
// any one thumbnail's artwork, never unmounted. Two states only: lit
// (default) and dimmed while dragging; it stays put and visible either way,
// just loses its glow. A crisp white core (linear-gradient) plus a tight
// near-glow (box-shadow) — no wide upward wash reaching for the vehicle,
// since the point is a gap between the light and the truck, not contact.
function ActiveLamp({ isDragging }: { isDragging: boolean }) {
  return (
    <motion.span
      aria-hidden="true"
      className="pointer-events-none absolute bottom-5 left-1/2 z-0 h-[3px] w-[100px] -translate-x-1/2 rounded-full sm:bottom-6 sm:w-[120px]"
      style={{
        background: "linear-gradient(90deg, transparent 0%, #dceeff 10%, #ffffff 50%, #dceeff 90%, transparent 100%)",
      }}
      initial={false}
      animate={
        isDragging
          ? { opacity: 0.4, boxShadow: "0 0 0 rgba(255,255,255,0)" }
          : {
              opacity: 1,
              boxShadow: "0 0 5px rgba(255,255,255,0.95), 0 0 12px rgba(103,181,255,0.75), 0 0 22px rgba(43,135,255,0.4)",
            }
      }
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    />
  );
}
