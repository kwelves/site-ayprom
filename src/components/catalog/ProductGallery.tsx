"use client";

import { useState } from "react";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DURATION, EASE_UI } from "@/lib/motion";
import { useIsTouchDevice } from "@/lib/use-is-touch-device";
import { ImageFallback } from "@/components/ui/ImageFallback";

interface ProductGalleryProps {
  images: { url: string; scale?: number }[];
  alt: string;
}

// Уход быстрее прихода, и оба идут одновременно (без mode="wait"): слайды
// абсолютно спозиционированы, поэтому наложение ничего не ломает, а нажатие
// на стрелку перестаёт ждать, пока доиграет предыдущий кадр.
const slideVariants = {
  enter: (direction: number) => ({ x: direction > 0 ? 32 : -32, opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { duration: DURATION.base, ease: EASE_UI } },
  exit: (direction: number) => ({
    x: direction > 0 ? -32 : 32,
    opacity: 0,
    transition: { duration: DURATION.fast, ease: EASE_UI },
  }),
};

const SWIPE_THRESHOLD = 50;

// A single photo needs none of this — no arrows, no dots, just the plain
// static image. The carousel only earns its keep once there's something to
// switch between.
export function ProductGallery({ images, alt }: ProductGalleryProps) {
  const [[index, direction], setIndex] = useState<[number, number]>([0, 0]);
  const hasMultiple = images.length > 1;
  const currentImage = images[index];
  const isTouchDevice = useIsTouchDevice();

  const goTo = (nextIndex: number) => {
    if (images.length === 0) return;
    const wrapped = (nextIndex + images.length) % images.length;
    setIndex([wrapped, nextIndex > index ? 1 : -1]);
  };

  // drag="x" is used purely for gesture detection, not visual movement:
  // dragConstraints + dragElastic={0} keep the element rigidly in place (no
  // finger-following wobble) — it behaves like pressing the arrow button,
  // just triggered by a swipe instead of a click. Framer Motion still locks
  // onto whichever axis the gesture actually moves in, so a mostly-vertical
  // touch is left alone for the browser's normal page scroll (reinforced by
  // touch-pan-y at the CSS level).
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
        dragElastic={0}
        onDragEnd={handleDragEnd}
      >
        <AnimatePresence initial={false} custom={direction}>
          <motion.div
            key={currentImage?.url ?? "image-fallback"}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="absolute inset-0"
          >
            <ImageFallback
              src={currentImage?.url}
              alt={alt}
              sizes="(max-width: 1023px) 100vw, 50vw"
              className="p-6"
              style={currentImage?.scale ? { transform: `scale(${currentImage.scale})` } : undefined}
              priority={index === 0}
            />
          </motion.div>
        </AnimatePresence>

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              aria-label="Предыдущее фото"
              className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <ChevronLeft aria-hidden="true" className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              aria-label="Следующее фото"
              className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <ChevronRight aria-hidden="true" className="h-5 w-5" />
            </button>
          </>
        )}
      </motion.div>

      {hasMultiple && (
        <div className="mt-3 flex items-center justify-center">
          {images.map((image, i) => (
            // p-2.5 padding around the dot enlarges the actual tap target well
            // past its 8px visual size, without making the indicator itself
            // look oversized — the dot stays small, only the hit area grows.
            <button
              key={`${image.url}-${i}`}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Показать фото ${i + 1}`}
              aria-current={i === index}
              className="p-2.5"
            >
              {/* Ширина у всех точек одинаковая, сжимается только сама точка:
                  анимировать `width` значило бы пересчитывать раскладку каждый
                  кадр, и вся строка точек «дышала» по ширине при переключении.
                  `scale` считается композитором и ничего не двигает. */}
              <span
                className={cn(
                  "block h-2 w-6 rounded-full transition-[scale,background-color] duration-fast ease-ui",
                  i === index ? "scale-x-100 bg-primary" : "scale-x-[0.333] bg-border hover:bg-primary-soft"
                )}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
