"use client";

import { useEffect, useRef } from "react";
import { MotionConfig, motion, type PanInfo } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsTouchDevice } from "@/lib/use-is-touch-device";
import {
  GalleryNeighborWarmup,
  PreparedImageLayers,
  usePreparedImageCarousel,
} from "@/components/ui/PreparedImageCarousel";

interface ProductGalleryProps {
  images: { url: string; scale?: number }[];
  alt: string;
}

const GALLERY_IMAGE_SIZES = "(max-width: 1023px) 100vw, 50vw";

const SWIPE_THRESHOLD = 50;

// A single photo needs none of this — no arrows, no dots, just the plain
// static image. The carousel only earns its keep once there's something to
// switch between.
export function ProductGallery({ images, alt }: ProductGalleryProps) {
  const carousel = usePreparedImageCarousel(images);
  const index = carousel.selectedIndex;
  const hasMultiple = images.length > 1;
  const isTouchDevice = useIsTouchDevice();
  const indicatorScrollRef = useRef<HTMLDivElement>(null);
  const activeIndicatorRef = useRef<HTMLButtonElement>(null);
  const didMountIndicatorsRef = useRef(false);

  useEffect(() => {
    if (!didMountIndicatorsRef.current) {
      didMountIndicatorsRef.current = true;
      return;
    }
    const container = indicatorScrollRef.current;
    const activeIndicator = activeIndicatorRef.current;
    if (!container || !activeIndicator) return;

    const visibleLeft = container.scrollLeft;
    const visibleRight = visibleLeft + container.clientWidth;
    const indicatorLeft = activeIndicator.offsetLeft;
    const indicatorRight = indicatorLeft + activeIndicator.offsetWidth;
    let nextLeft = visibleLeft;

    if (indicatorLeft < visibleLeft) nextLeft = indicatorLeft;
    else if (indicatorRight > visibleRight) nextLeft = indicatorRight - container.clientWidth;

    if (nextLeft !== visibleLeft) {
      container.scrollTo({ left: nextLeft, behavior: "smooth" });
    }
  }, [index]);

  // drag="x" is used purely for gesture detection, not visual movement:
  // dragConstraints + dragElastic={0} keep the element rigidly in place (no
  // finger-following wobble) — it behaves like pressing the arrow button,
  // just triggered by a swipe instead of a click. Framer Motion still locks
  // onto whichever axis the gesture actually moves in, so a mostly-vertical
  // touch is left alone for the browser's normal page scroll (reinforced by
  // touch-pan-y at the CSS level).
  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.x < -SWIPE_THRESHOLD) {
      carousel.step(1);
    } else if (info.offset.x > SWIPE_THRESHOLD) {
      carousel.step(-1);
    }
  };

  return (
    <div>
      {/* Локальная замена снятой глобальной MotionPreferences: reduced-motion
          поддерживается там, где framer-motion действительно используется, без
          обёртки на весь публичный layout. MotionConfig не добавляет DOM. */}
      <MotionConfig reducedMotion="user">
      <motion.div
        className="relative aspect-4/3 w-full touch-pan-y overflow-hidden rounded-xl border border-border bg-muted/40"
        drag={hasMultiple && isTouchDevice ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0}
        onDragEnd={handleDragEnd}
      >
        <PreparedImageLayers
          images={images}
          alt={alt}
          sizes={GALLERY_IMAGE_SIZES}
          unoptimized
          layerClassName="absolute inset-0"
          imageClassName="p-6"
          carousel={carousel}
        />

        {hasMultiple && carousel.neighborIndices.map((neighborIndex) => (
          <GalleryNeighborWarmup
            key={`${images[neighborIndex].url}-${neighborIndex}`}
            url={images[neighborIndex].url}
            sizes={GALLERY_IMAGE_SIZES}
            unoptimized
          />
        ))}

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={() => carousel.step(-1)}
              aria-label="Предыдущее фото"
              className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-[background-color,scale] duration-fast ease-ui hover:bg-primary-hover active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <ChevronLeft aria-hidden="true" className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => carousel.step(1)}
              aria-label="Следующее фото"
              className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-[background-color,scale] duration-fast ease-ui hover:bg-primary-hover active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <ChevronRight aria-hidden="true" className="h-5 w-5" />
            </button>
          </>
        )}
      </motion.div>
      </MotionConfig>

      {hasMultiple && (
        <div
          ref={indicatorScrollRef}
          data-testid="product-gallery-indicator-scroll"
          className="mt-3 w-full max-w-full overflow-x-auto overscroll-x-contain [scrollbar-width:none]"
        >
          <div className="mx-auto flex w-max items-center">
            {images.map((image, i) => (
              // The button keeps a real 44px target while the visual dot
              // remains compact. The surrounding w-max row scrolls locally.
              <button
                key={`${image.url}-${i}`}
                ref={i === index ? activeIndicatorRef : undefined}
                type="button"
                onClick={() => carousel.select(i)}
                aria-label={`Показать фото ${i + 1}`}
                aria-current={i === index}
                className="grid h-11 w-11 place-items-center transition-transform duration-fast ease-ui active:scale-90"
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
        </div>
      )}
    </div>
  );
}
