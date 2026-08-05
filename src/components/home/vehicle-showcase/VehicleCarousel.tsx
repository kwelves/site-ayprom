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
  const [slotWidth, setSlotWidth] = useState(120);
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
    <div className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-6 sm:px-8">
      {/* Edge-fade mask: items dissolve into the container edge instead of
          being hard-clipped or (the thing we're avoiding) visibly flying in
          from the opposite side. */}
      <div
        ref={maskRef}
        className="relative h-24 overflow-hidden sm:h-28"
        style={{
          maskImage: "linear-gradient(to right, transparent, black 14%, black 86%, transparent)",
          WebkitMaskImage: "linear-gradient(to right, transparent, black 14%, black 86%, transparent)",
        }}
      >
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
                className="absolute top-1/2 left-1/2 h-14 w-24 -translate-x-1/2 -translate-y-1/2 outline-none sm:h-16 sm:w-32"
                initial={{ x: slot.position * slotWidth, opacity: 0 }}
                animate={{
                  x: slot.position * slotWidth,
                  opacity: isActive || isNear ? 1 : 0.22,
                  scale: isActive ? 1 : isNear ? 0.82 : 0.62,
                  filter: isActive ? "brightness(1) blur(0px)" : isNear ? "brightness(0.87) blur(0px)" : "brightness(0.7) blur(4px)",
                }}
                transition={{ type: "spring", stiffness: 260, damping: 30 }}
              >
                {isActive && <ActiveLamp isDragging={isDragging} />}
                <div className="relative h-full w-full">
                  <Image src={item.image} alt="" fill sizes="128px" className="object-contain" draggable={false} />
                </div>
              </motion.button>
            );
          })}
        </motion.div>
      </div>
    </div>
  );
}

// Three-layer LED-rail glow under the active thumbnail's wheels: a crisp
// white core, a tight blue near-glow (box-shadow), and a wide soft upward
// radial wash lighting the vehicle from below. Opacity stays modest even at
// full brightness — the "expensive" look comes from spreading the soft
// glow wider, not from pushing intensity up.
function ActiveLamp({ isDragging }: { isDragging: boolean }) {
  return (
    <motion.span
      aria-hidden="true"
      className="pointer-events-none absolute bottom-2 left-1/2 h-1 w-[70px] -translate-x-1/2 rounded-full sm:w-[90px]"
      style={{
        background: "linear-gradient(90deg, transparent 0%, #dceeff 10%, #ffffff 50%, #dceeff 90%, transparent 100%)",
        boxShadow: "0 0 5px rgba(255,255,255,0.95), 0 0 12px rgba(103,181,255,0.75), 0 0 24px rgba(43,135,255,0.45)",
      }}
      initial={false}
      animate={{ opacity: isDragging ? 0 : 1, scaleX: isDragging ? 0.35 : 1 }}
      transition={{ opacity: { duration: 0.28 }, scaleX: { duration: 0.48, ease: [0.22, 1, 0.36, 1] } }}
    >
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-8px] left-1/2 -z-10 h-16 w-[140px] -translate-x-1/2 sm:w-[170px]"
        style={{
          background:
            "radial-gradient(ellipse at 50% 100%, rgba(92,169,255,0.38) 0%, rgba(66,145,255,0.17) 35%, transparent 72%)",
          filter: "blur(10px)",
        }}
      />
    </motion.span>
  );
}
