"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MotionConfig, motion, type PanInfo } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsTouchDevice } from "@/lib/use-is-touch-device";
import { ImageLightbox } from "@/components/catalog/ImageLightbox";
import {
  GalleryNeighborWarmup,
  getPreparedImageKey,
  PreparedImageLayers,
  usePreparedImageCarousel,
} from "@/components/ui/PreparedImageCarousel";

interface ProductGalleryProps {
  images: { url: string; fallbackUrl?: string; scale?: number }[];
  alt: string;
}

const GALLERY_IMAGE_SIZES = "(max-width: 1023px) 100vw, 50vw";

const SWIPE_THRESHOLD = 50;

interface GalleryNetworkInformation {
  effectiveType?: string;
  saveData?: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
}

function getNetworkInformation(): GalleryNetworkInformation | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { connection?: GalleryNetworkInformation }).connection;
}

function subscribeToNetworkChanges(onStoreChange: () => void) {
  const connection = getNetworkInformation();
  if (
    !connection ||
    typeof connection.addEventListener !== "function" ||
    typeof connection.removeEventListener !== "function"
  ) {
    return () => undefined;
  }

  connection.addEventListener("change", onStoreChange);
  return () => connection.removeEventListener?.("change", onStoreChange);
}

// Product photos are small pre-built WebP variants, so every photo is fetched in the background right
// after the first one is shown: switching must never wait for the network. Only an explicit request to
// save data, or a 2G link, turns that off. Browsers without the Network Information API (Safari,
// Firefox) are allowed too. The server snapshot stays false so hydration never sees a warmup.
function allowsBackgroundImageWarmup() {
  const connection = getNetworkInformation();
  if (connection?.saveData === true) return false;
  return connection?.effectiveType !== "slow-2g" && connection?.effectiveType !== "2g";
}

function useBackgroundImageWarmupAllowed() {
  return useSyncExternalStore(subscribeToNetworkChanges, allowsBackgroundImageWarmup, () => false);
}

// A single photo needs none of this — no arrows, no dots, just the plain
// static image. The carousel only earns its keep once there's something to
// switch between.
export function ProductGallery({ images, alt }: ProductGalleryProps) {
  const carousel = usePreparedImageCarousel(images);
  const [readyFirstImageKey, setReadyFirstImageKey] = useState<string | null>(null);
  const firstImageKey = getPreparedImageKey(images[0], 0);
  const warmupAllowed = useBackgroundImageWarmupAllowed();
  const index = carousel.selectedIndex;
  const hasMultiple = images.length > 1;
  const isTouchDevice = useIsTouchDevice();
  const indicatorScrollRef = useRef<HTMLDivElement>(null);
  const activeIndicatorRef = useRef<HTMLButtonElement>(null);
  const didMountIndicatorsRef = useRef(false);
  const handleImageReady = useCallback((imageIndex: number, imageKey: string) => {
    if (imageIndex === 0) setReadyFirstImageKey(imageKey);
  }, []);
  // The photo opens large on a click. A swipe on a phone also ends with a click, so a click right after a
  // swipe is ignored: the swipe only changes the photo.
  const [zoomedIndex, setZoomedIndex] = useState<number | null>(null);
  const swipedAtRef = useRef(0);
  // After closing, the gallery stays on the photo that was last on screen in the enlarged view.
  const closeZoom = (lastIndex: number) => {
    setZoomedIndex(null);
    if (lastIndex !== index) carousel.select(lastIndex);
  };

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
    if (Math.abs(info.offset.x) > 8) swipedAtRef.current = Date.now();
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
          loading="lazy"
          initialImageLoading="eager"
          initialImageFetchPriority="high"
          onImageReady={handleImageReady}
          carousel={carousel}
        />

        {/* The whole photo is the zoom button; the arrows sit above it (z-10) and keep their own clicks. */}
        <button
          type="button"
          onClick={() => {
            if (Date.now() - swipedAtRef.current < 400) return;
            setZoomedIndex(index);
          }}
          aria-label="Увеличить фото"
          className="absolute inset-0 z-[5] cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
        />

        {hasMultiple && readyFirstImageKey === firstImageKey && warmupAllowed
          && images.slice(1).map((image, offset) => image.url && (
            <GalleryNeighborWarmup
              key={`${image.url}-${offset + 1}`}
              url={image.url}
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

      {zoomedIndex !== null && <ImageLightbox images={images} startIndex={zoomedIndex} alt={alt} onClose={closeZoom} />}
    </div>
  );
}
