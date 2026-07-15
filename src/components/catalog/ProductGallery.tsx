"use client";

import { useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsTouchDevice } from "@/lib/use-is-touch-device";

interface ProductGalleryProps {
  images: string[];
  alt: string;
}

const slideVariants = {
  enter: (direction: number) => ({ x: direction > 0 ? 32 : -32, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction > 0 ? -32 : 32, opacity: 0 }),
};

const SWIPE_THRESHOLD = 50;

// A single photo needs none of this — no arrows, no dots, just the plain
// static image. The carousel only earns its keep once there's something to
// switch between.
export function ProductGallery({ images, alt }: ProductGalleryProps) {
  const [[index, direction], setIndex] = useState<[number, number]>([0, 0]);
  const hasMultiple = images.length > 1;
  const isTouchDevice = useIsTouchDevice();

  const goTo = (nextIndex: number) => {
    const wrapped = (nextIndex + images.length) % images.length;
    setIndex([wrapped, nextIndex > index ? 1 : -1]);
  };

  // drag="x" + dragConstraints of 0 gives a rubber-band swipe: Framer Motion
  // locks onto whichever axis the gesture actually moves in, so a mostly-
  // vertical touch is left alone for the browser's normal page scroll.
  // touch-pan-y reinforces that at the CSS level (only vertical panning is
  // reserved for native scrolling on this element).
  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.x < -SWIPE_THRESHOLD) {
      goTo(index + 1);
    } else if (info.offset.x > SWIPE_THRESHOLD) {
      goTo(index - 1);
    }
  };

  return (
    <div>
      <motion.div
        className="relative aspect-4/3 w-full touch-pan-y overflow-hidden rounded-xl border border-border bg-muted/40"
        drag={hasMultiple && isTouchDevice ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.15}
        onDragEnd={handleDragEnd}
      >
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.div
            key={index}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="absolute inset-0"
          >
            <Image
              src={images[index]}
              alt={alt}
              fill
              sizes="(max-width: 1023px) 100vw, 50vw"
              className="object-contain p-6"
              priority={index === 0}
              draggable={false}
            />
          </motion.div>
        </AnimatePresence>

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              aria-label="Предыдущее фото"
              className="absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              aria-label="Следующее фото"
              className="absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </motion.div>

      {hasMultiple && (
        <div className="mt-3 flex items-center justify-center gap-2">
          {images.map((image, i) => (
            <button
              key={`${image}-${i}`}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Показать фото ${i + 1}`}
              aria-current={i === index}
              className={cn(
                "h-2 rounded-full transition-all",
                i === index ? "w-6 bg-primary" : "w-2 bg-border hover:bg-blue-300"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
