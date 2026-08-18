"use client";

import { useState } from "react";
import { getImageProps } from "next/image";
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

const GALLERY_IMAGE_SIZES = "(max-width: 1023px) 100vw, 50vw";

// Hidden 1px warmup <img>s for the arrow-adjacent photos, using the exact
// same optimizer URL the visible stage requests (same `sizes`, no
// `quality` override) so a later arrow click almost always finds the image
// already in the browser's HTTP cache instead of starting the fetch at
// click time. `loading: "eager"` is required here — an offscreen/opacity-0
// image left at its next/image default of `loading="lazy"` would be skipped
// by the browser's own native lazy-load heuristic, defeating the warmup.
function GalleryNeighborWarmup({ url }: { url: string }) {
  const { props } = getImageProps({
    src: url,
    alt: "",
    fill: true,
    sizes: GALLERY_IMAGE_SIZES,
    loading: "eager",
  });

  return (
    // Deliberately a plain <img>, not next/image's <Image>: only its network
    // request matters, nothing here is ever meant to paint.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      alt=""
      aria-hidden="true"
      fetchPriority="low"
      decoding="async"
      // Replaces (not merges with) the `fill` styles getImageProps returns —
      // this element must never actually cover the gallery.
      style={{ position: "absolute", height: 1, width: 1, opacity: 0, pointerEvents: "none" }}
    />
  );
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
  // The last photo actually confirmed loaded — rendered as a static base
  // layer beneath the animated slide stack. A slow fetch for the newly
  // selected photo then never leaves the frame empty: the previous photo
  // just keeps showing through until the new one is ready to paint over it.
  const [loadedUrl, setLoadedUrl] = useState(currentImage?.url);
  const loadedImage = images.find((image) => image.url === loadedUrl) ?? currentImage;

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
        {/* Base layer: always the last confirmed-loaded photo, painted first
            so it shows through the animated layer above while that layer's
            own image is still in flight — see the `loadedUrl` comment above. */}
        <ImageFallback
          src={loadedImage?.url}
          alt={alt}
          sizes={GALLERY_IMAGE_SIZES}
          className="p-6"
          style={loadedImage?.scale ? { transform: `scale(${loadedImage.scale})` } : undefined}
          priority
        />

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
              sizes={GALLERY_IMAGE_SIZES}
              className="p-6"
              style={currentImage?.scale ? { transform: `scale(${currentImage.scale})` } : undefined}
              priority={index === 0}
              onLoad={() => setLoadedUrl(currentImage?.url)}
            />
          </motion.div>
        </AnimatePresence>

        {hasMultiple &&
          [...new Set([index + 1, index - 1].map((rawIndex) => (rawIndex + images.length) % images.length))]
            .filter((neighborIndex) => images[neighborIndex]?.url && images[neighborIndex].url !== currentImage?.url)
            .map((neighborIndex) => (
              <GalleryNeighborWarmup key={images[neighborIndex].url} url={images[neighborIndex].url} />
            ))}

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              aria-label="Предыдущее фото"
              className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-[background-color,scale] duration-fast ease-ui hover:bg-primary-hover active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <ChevronLeft aria-hidden="true" className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              aria-label="Следующее фото"
              className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-[background-color,scale] duration-fast ease-ui hover:bg-primary-hover active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
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
              className="p-2.5 transition-transform duration-fast ease-ui active:scale-90"
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
