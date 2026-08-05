"use client";

import { useRef } from "react";
import Image from "next/image";
import { motion, type PanInfo } from "framer-motion";
import { cn } from "@/lib/utils";

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

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
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
    <motion.div
      className="mx-auto flex max-w-md touch-pan-y items-center justify-center gap-3 sm:max-w-lg sm:gap-4"
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.15}
      onDragStart={() => {
        didDragRef.current = true;
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
                scale: isActive ? 1 : distance === 1 ? 0.78 : 0.6,
                opacity: isActive ? 1 : distance === 1 ? 0.55 : 0.3,
                filter: isActive ? "blur(0px)" : distance === 1 ? "blur(0.5px)" : "blur(1.5px)",
              }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className={cn(
                "relative h-16 w-20 overflow-hidden rounded-lg border bg-[#0b1220] sm:h-20 sm:w-24",
                isActive ? "border-[#3b82f6]" : "border-white/10",
              )}
            >
              <Image
                src={item.image}
                alt=""
                fill
                sizes="96px"
                className="object-cover"
                draggable={false}
              />
            </motion.div>
            <motion.span
              aria-hidden="true"
              className="mx-auto mt-1.5 block h-[3px] rounded-full bg-[#3b82f6] shadow-[0_0_8px_rgba(59,130,246,0.8)]"
              animate={{ width: isActive ? 24 : 0, opacity: isActive ? 1 : 0 }}
              transition={{ duration: 0.2 }}
            />
          </motion.button>
        );
      })}
    </motion.div>
  );
}
