"use client";

import { forwardRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, motion, type PanInfo, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Clock, Maximize2, X } from "lucide-react";
import { ImageFallback } from "@/components/ui/ImageFallback";
import { DURATION, EASE_UI } from "@/lib/motion";
import { useIsTouchDevice } from "@/lib/use-is-touch-device";
import { cn } from "@/lib/utils";
import type { HotspotProduct } from "@/lib/queries/vehicle-hotspots";

interface ProductPanelProps {
  label: string;
  product: HotspotProduct | null;
  /** Powers "В каталог" — links to the cross-category listing for the
   * vehicle currently shown on stage, not the product's own category. */
  vehicleTypeSlug: string;
}

// Mirrors the product-page gallery: the outgoing image leaves more quickly
// than the next one arrives, so repeated next/previous presses stay crisp
// instead of queueing a sequence of stale slides.
const slideVariants = {
  enter: (direction: number) => ({ x: direction > 0 ? 20 : -20, opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { duration: DURATION.base, ease: EASE_UI } },
  exit: (direction: number) => ({
    x: direction > 0 ? -20 : 20,
    opacity: 0,
    transition: { duration: DURATION.fast, ease: EASE_UI },
  }),
};

const SWIPE_THRESHOLD = 40;

// White card on the dark showcase scene, deliberately — it keeps the product
// distinct from the glow around it. Single border, full stop — the glowing
// "connected" outline is drawn by the Connector's SVG branches tracing
// this same card's edges (see VehicleShowcaseInteractive), not a second
// CSS ring layered on top. Two separate roundings of "the same edge" is
// exactly what looked like a double border before. The corner radius here
// (rounded-2xl) is load-bearing: connector-geometry.ts's CORNER_MAX
// constant has to match it or the traced outline visibly diverges from
// the card's real corner.
export const ProductPanel = forwardRef<HTMLDivElement, ProductPanelProps>(function ProductPanel(
  { label, product, vehicleTypeSlug },
  ref,
) {
  const [zoomed, setZoomed] = useState(false);
  const [[imageIndex, imageDirection], setImage] = useState<[number, number]>([0, 0]);
  const shouldReduceMotion = useReducedMotion();
  const isTouchDevice = useIsTouchDevice();
  const images = product?.images ?? [];
  const hasMultipleImages = images.length > 1;
  const currentImage = images[imageIndex];

  const goToImage = (nextIndex: number) => {
    if (images.length === 0) return;
    const wrapped = (nextIndex + images.length) % images.length;
    setImage([wrapped, nextIndex > imageIndex ? 1 : -1]);
  };

  const handleImageDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.x < -SWIPE_THRESHOLD) {
      goToImage(imageIndex + 1);
    } else if (info.offset.x > SWIPE_THRESHOLD) {
      goToImage(imageIndex - 1);
    }
  };

  useEffect(() => {
    if (!zoomed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomed(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [zoomed]);

  return (
    <div
      ref={ref}
      className="relative flex min-h-[220px] flex-col overflow-hidden rounded-2xl border border-border bg-card lg:h-full lg:min-h-0"
    >
      {product ? (
        <>
          <div className="relative flex min-h-0 flex-col px-4 pt-12 pb-0 sm:px-6 sm:pt-[52px] lg:flex-1 lg:px-5">
            <p className="absolute top-4 left-4 max-w-[calc(100%-4.5rem)] text-[13px] leading-[1.1] font-semibold tracking-wide text-primary uppercase sm:top-3 sm:left-6 sm:max-w-none lg:left-5">
              {label}
            </p>
            <button
              type="button"
              onClick={() => setZoomed(true)}
              aria-label="Увеличить фото"
              className="absolute top-2 right-2 z-10 inline-flex h-11 w-11 items-center justify-center gap-1 rounded-full border border-border bg-card p-0 text-[13px] leading-[1.1] font-semibold text-muted-foreground shadow-sm transition-[background-color,color,scale] duration-fast ease-ui hover:border-border-interactive hover:bg-muted hover:text-primary active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:top-3 sm:right-3 sm:h-auto sm:w-auto sm:px-[11px] sm:py-[4.5px]"
            >
              <Maximize2 aria-hidden="true" className="h-4 w-4 sm:h-[13px] sm:w-[13px]" />
              <span className="sr-only sm:not-sr-only">Увеличить</span>
            </button>

            <div className="grid min-h-0 grid-rows-[auto_auto] lg:flex-1 lg:grid-rows-[minmax(0,1fr)_auto]">
              <div className="flex min-h-0 items-center justify-center">
                <motion.div
                  data-testid="product-panel-media"
                  className="relative h-[168px] w-full max-w-[320px] touch-pan-y overflow-hidden sm:aspect-square sm:h-auto sm:max-w-[300px] lg:h-full lg:max-h-[320px] lg:w-auto lg:max-w-full"
                  drag={hasMultipleImages && isTouchDevice ? "x" : false}
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0}
                  onDragEnd={handleImageDragEnd}
                >
                  <AnimatePresence initial={false} custom={imageDirection}>
                    <motion.div
                      key={currentImage?.url ?? "image-fallback"}
                      custom={imageDirection}
                      variants={slideVariants}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      className="absolute inset-0 scale-[1.18] sm:scale-100"
                    >
                      <ImageFallback
                        src={currentImage?.url}
                        alt={product.name}
                        sizes="(max-width: 639px) 320px, (max-width: 1023px) 300px, 320px"
                        className="object-cover p-0 sm:object-contain sm:p-1"
                        style={currentImage?.scale ? { transform: `scale(${currentImage.scale})` } : undefined}
                        priority={imageIndex === 0}
                      />
                    </motion.div>
                  </AnimatePresence>

                  {hasMultipleImages && (
                    <>
                      <button
                        type="button"
                        onClick={() => goToImage(imageIndex - 1)}
                        aria-label="Предыдущее фото"
                        className="absolute top-1/2 left-1 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-[background-color,scale] duration-fast ease-ui hover:bg-primary-hover active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 lg:left-0 lg:h-8 lg:w-8"
                      >
                        <ChevronLeft aria-hidden="true" className="h-5 w-5 lg:h-4 lg:w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => goToImage(imageIndex + 1)}
                        aria-label="Следующее фото"
                        className="absolute top-1/2 right-1 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-[background-color,scale] duration-fast ease-ui hover:bg-primary-hover active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 lg:right-0 lg:h-8 lg:w-8"
                      >
                        <ChevronRight aria-hidden="true" className="h-5 w-5 lg:h-4 lg:w-4" />
                      </button>
                    </>
                  )}
                </motion.div>
              </div>

              {hasMultipleImages && (
                <div className="mt-1 flex flex-wrap items-center justify-center lg:mt-5">
                  {images.map((image, index) => (
                    <button
                      key={`${image.url}-${index}`}
                      type="button"
                      onClick={() => goToImage(index)}
                      aria-label={`Показать фото ${index + 1}`}
                      aria-current={index === imageIndex}
                      className="flex h-11 w-11 items-center justify-center transition-transform duration-fast ease-ui active:scale-90 lg:h-auto lg:w-auto lg:p-2"
                    >
                      <span
                        className={cn(
                          "block h-1.5 w-5 rounded-full transition-[scale,background-color] duration-fast ease-ui",
                          index === imageIndex ? "scale-x-100 bg-primary" : "scale-x-[0.333] bg-muted-foreground/60 hover:bg-primary-soft",
                        )}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-0.5 pb-0 text-center sm:mt-1.5 lg:mt-2.5">
              <h3 className="text-base font-bold text-card-foreground lg:text-sm">{product.name}</h3>
            </div>
          </div>

          <div className="mt-1.5 grid grid-cols-[1.15fr_0.85fr] gap-2 px-3 pb-3 sm:mt-2 lg:mt-2.5 lg:grid-cols-2">
            <Link
              href={`/product/${product.slug}`}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-3 py-3 text-center text-sm font-semibold text-primary-foreground transition-[background-color,scale] duration-fast ease-ui hover:bg-primary-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 lg:min-h-0 lg:py-2.5 lg:text-xs"
            >
              Подробнее
            </Link>
            <Link
              href={`/catalog/vehicle-type/${vehicleTypeSlug}`}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary bg-card px-3 py-3 text-center text-sm font-semibold text-primary transition-[background-color,color,border-color,scale] duration-fast ease-ui hover:bg-primary-soft active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 lg:min-h-0 lg:border-transparent lg:bg-primary lg:py-2.5 lg:text-xs lg:text-primary-foreground lg:hover:bg-primary-hover"
            >
              В каталог
            </Link>
          </div>

          {typeof document !== "undefined" &&
            createPortal(
              <AnimatePresence>
                {zoomed && (
                  <motion.div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-inverse/70 p-4 backdrop-blur-sm"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: DURATION.fast }}
                    onClick={() => setZoomed(false)}
                    role="dialog"
                    aria-modal="true"
                    aria-label={product.name}
                  >
                    <motion.div
                      className="relative w-full max-w-md rounded-2xl bg-card p-4"
                      initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
                      animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
                      transition={{ duration: DURATION.base, ease: EASE_UI }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => setZoomed(false)}
                        aria-label="Закрыть"
                        className="absolute top-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-[background-color,color,scale] duration-fast ease-ui hover:bg-muted hover:text-primary active:scale-90"
                      >
                        <X aria-hidden="true" className="h-4 w-4" />
                      </button>
                      <div className="relative aspect-square w-full">
                        <ImageFallback
                          src={currentImage?.url}
                          alt={product.name}
                          sizes="(max-width: 639px) 90vw, 448px"
                          className="p-4"
                          style={currentImage?.scale ? { transform: `scale(${currentImage.scale})` } : undefined}
                        />
                      </div>
                      <p className="mt-2 text-center text-sm font-semibold text-card-foreground">{product.name}</p>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>,
              document.body,
            )}
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-5 text-center sm:p-6 lg:p-4">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-muted text-primary">
            <Clock aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-semibold tracking-wide text-primary uppercase">{label}</p>
            <p className="mt-1 text-sm text-muted-foreground">Карточка скоро появится</p>
          </div>
        </div>
      )}
    </div>
  );
});
