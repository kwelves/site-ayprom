"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { motion, type PanInfo } from "framer-motion";

const SWIPE_THRESHOLD = 40;

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

// Circular ("looped") distance to the active slot — with only 5 items this
// reads as cover-flow without needing to render duplicate/infinite DOM: a
// neighbour past the last index just wraps to the front visually via its
// signed offset.
function loopedOffset(index: number, activeIndex: number, count: number) {
  let offset = index - activeIndex;
  if (offset > count / 2) offset -= count;
  if (offset < -count / 2) offset += count;
  return offset;
}

export function VehicleCarousel({ items, activeIndex, onSelect }: VehicleCarouselProps) {
  const didDragRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setIsDragging(false);
    if (info.offset.x < -SWIPE_THRESHOLD) {
      onSelect((activeIndex + 1) % items.length);
    } else if (info.offset.x > SWIPE_THRESHOLD) {
      onSelect((activeIndex - 1 + items.length) % items.length);
    }
    requestAnimationFrame(() => {
      didDragRef.current = false;
    });
  };

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-6 sm:px-8">
      {/* Edge-fade mask: neighbours dissolve into the container edge
          instead of being hard-clipped, so the "infinite" loop reads as
          continuous rather than a visibly bounded strip. */}
      <div
        className="overflow-hidden"
        style={{
          maskImage: "linear-gradient(to right, transparent, black 14%, black 86%, transparent)",
          WebkitMaskImage: "linear-gradient(to right, transparent, black 14%, black 86%, transparent)",
        }}
      >
        <motion.div
          className="flex touch-pan-y items-center justify-center gap-6 py-2 sm:gap-10"
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.15}
          onDragStart={() => {
            didDragRef.current = true;
            setIsDragging(true);
          }}
          onDragEnd={handleDragEnd}
        >
          {items.map((item, index) => {
            const offset = loopedOffset(index, activeIndex, items.length);
            const distance = Math.abs(offset);
            const isActive = distance === 0;

            return (
              <motion.button
                key={item.slug}
                layout
                type="button"
                onClick={() => {
                  if (!didDragRef.current) onSelect(index);
                }}
                aria-label={item.name}
                aria-current={isActive}
                className="relative shrink-0 outline-none"
                style={{ order: offset }}
              >
                <motion.div
                  animate={{
                    scale: isActive ? 1 : distance === 1 ? 0.72 : 0.55,
                    opacity: isActive ? 1 : distance === 1 ? 0.45 : 0.2,
                    filter: isActive ? "blur(0px)" : distance === 1 ? "blur(1px)" : "blur(2px)",
                  }}
                  transition={{ type: "spring", stiffness: 300, damping: 28 }}
                  className="relative h-16 w-20 sm:h-20 sm:w-24"
                >
                  <Image src={item.image} alt="" fill sizes="96px" className="object-contain" draggable={false} />
                </motion.div>

                {/* The "lamp" — a glowing bar under the focused thumbnail
                    that lights the vehicle above it; it dims while the
                    strip is being dragged and relights once it settles. */}
                <motion.span
                  aria-hidden="true"
                  className="absolute -bottom-3 left-1/2 h-1.5 -translate-x-1/2 rounded-full bg-white"
                  animate={{
                    width: isActive ? 40 : 0,
                    opacity: isActive ? (isDragging ? 0.25 : 1) : 0,
                    boxShadow: isActive
                      ? "0 0 18px 6px rgba(255,255,255,0.55), 0 0 40px 14px rgba(59,130,246,0.35)"
                      : "none",
                  }}
                  transition={{ duration: 0.25 }}
                />
              </motion.button>
            );
          })}
        </motion.div>
      </div>
    </div>
  );
}
