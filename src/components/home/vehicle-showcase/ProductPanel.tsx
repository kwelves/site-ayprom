"use client";

import { forwardRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, motion, type PanInfo, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Clock, Maximize2, X } from "lucide-react";
import { ImageFallback } from "@/components/ui/ImageFallback";
import {
  GalleryNeighborWarmup,
  PreparedImageLayers,
  usePreparedImageCarousel,
} from "@/components/ui/PreparedImageCarousel";
import { DURATION, EASE_UI } from "@/lib/motion";
import { useIsTouchDevice } from "@/lib/use-is-touch-device";
import { cn } from "@/lib/utils";
import type { HotspotProduct } from "@/lib/queries/vehicle-hotspots";
import styles from "./ProductPanel.module.css";

interface ProductPanelProps {
  label: string;
  product: HotspotProduct | null;
  /** Links to the cross-category listing for the vehicle on stage. */
  vehicleTypeSlug: string;
}

const SWIPE_THRESHOLD = 40;
const PANEL_IMAGE_SIZES = "(max-width: 639px) 65vw, (max-width: 1023px) 360px, 30vw";

export const ProductPanel = forwardRef<HTMLDivElement, ProductPanelProps>(function ProductPanel(
  { label, product, vehicleTypeSlug },
  ref,
) {
  const [zoomed, setZoomed] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const isTouchDevice = useIsTouchDevice();
  const images = product?.images ?? [];
  const carousel = usePreparedImageCarousel(images);
  const imageIndex = carousel.selectedIndex;
  const hasMultipleImages = images.length > 1;
  const currentImage = images[imageIndex];

  const handleImageDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.x < -SWIPE_THRESHOLD) carousel.step(1);
    else if (info.offset.x > SWIPE_THRESHOLD) carousel.step(-1);
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
      data-testid="product-panel"
      data-layout-scope="product-panel"
      className={cn(
        styles.panel,
        "relative min-h-[220px] overflow-hidden rounded-2xl border border-border bg-card lg:min-h-[29rem]",
      )}
    >
      {product ? (
        <div className={styles.layout}>
          <header className={styles.header}>
            <p className="min-w-0 text-[13px] leading-[1.1] font-semibold tracking-wide text-primary uppercase">
              {label}
            </p>
            <button
              type="button"
              onClick={() => setZoomed(true)}
              aria-label="Увеличить фото"
              className={cn(
                styles.zoomButton,
                "inline-flex h-11 shrink-0 items-center justify-center gap-1 rounded-full border border-border bg-card text-[13px] leading-[1.1] font-semibold text-muted-foreground shadow-sm transition-[background-color,color,scale] duration-fast ease-ui hover:border-border-interactive hover:bg-muted hover:text-primary active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
              )}
            >
              <Maximize2 aria-hidden="true" className="h-4 w-4" />
              <span className={styles.zoomLabel}>Увеличить</span>
            </button>
          </header>

          <div className={styles.main}>
            <div
              data-testid="product-gallery"
              data-gallery-layout={hasMultipleImages ? "controls-media-controls" : "media-only"}
              className={cn(styles.gallery, !hasMultipleImages && styles.gallerySingle)}
            >
              {hasMultipleImages && (
                <button
                  type="button"
                  onClick={() => carousel.step(-1)}
                  aria-label="Предыдущее фото"
                  className={cn(
                    styles.arrowHit,
                    styles.previous,
                    "z-10 rounded-full transition-transform duration-fast ease-ui active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      styles.arrowVisual,
                      "rounded-full bg-primary text-primary-foreground shadow-sm transition-colors duration-fast ease-ui hover:bg-primary-hover",
                    )}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </span>
                </button>
              )}

              <motion.div
                data-testid="product-panel-media"
                data-image-fit="contain"
                className={cn(styles.media, !hasMultipleImages && styles.mediaSingle)}
                drag={hasMultipleImages && isTouchDevice ? "x" : false}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0}
                onDragEnd={handleImageDragEnd}
              >
                <PreparedImageLayers
                  images={images}
                  alt={product.name}
                  sizes={PANEL_IMAGE_SIZES}
                  layerClassName={styles.slide}
                  imageClassName="object-contain"
                  carousel={carousel}
                />

                {hasMultipleImages && carousel.neighborIndices.map((neighborIndex) => (
                  <GalleryNeighborWarmup
                    key={`${images[neighborIndex].url}-${neighborIndex}`}
                    url={images[neighborIndex].url}
                    sizes={PANEL_IMAGE_SIZES}
                  />
                ))}
              </motion.div>

              {hasMultipleImages && (
                <button
                  type="button"
                  onClick={() => carousel.step(1)}
                  aria-label="Следующее фото"
                  className={cn(
                    styles.arrowHit,
                    styles.next,
                    "z-10 rounded-full transition-transform duration-fast ease-ui active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      styles.arrowVisual,
                      "rounded-full bg-primary text-primary-foreground shadow-sm transition-colors duration-fast ease-ui hover:bg-primary-hover",
                    )}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </span>
                </button>
              )}

              {hasMultipleImages && (
                <div data-testid="product-image-indicators" className={styles.indicators}>
                  {images.map((image, index) => (
                    <button
                      key={`${image.url}-${index}`}
                      type="button"
                      onClick={() => carousel.select(index)}
                      aria-label={`Показать фото ${index + 1}`}
                      aria-current={index === imageIndex}
                      className={cn(
                        styles.indicatorHit,
                        "transition-transform duration-fast ease-ui active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                      )}
                    >
                      <span
                        className={cn(
                          "block h-1.5 w-5 rounded-full transition-[scale,background-color] duration-fast ease-ui",
                          index === imageIndex
                            ? "scale-x-100 bg-primary"
                            : "scale-x-[0.333] bg-muted-foreground/60 hover:bg-primary-soft",
                        )}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <h3
              data-card-title
              className={cn(styles.title, "text-center text-base font-bold text-card-foreground")}
            >
              {product.name}
            </h3>
          </div>

          <div className={styles.actions}>
            <Link
              href={`/product/${product.slug}`}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-3 py-2.5 text-center text-sm font-semibold text-primary-foreground transition-[background-color,scale] duration-fast ease-ui hover:bg-primary-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Подробнее
            </Link>
            <Link
              href={`/catalog/vehicle-type/${vehicleTypeSlug}`}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary bg-card px-3 py-2.5 text-center text-sm font-semibold text-primary transition-[background-color,color,border-color,scale] duration-fast ease-ui hover:bg-primary-soft active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
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
                        className="absolute top-3 right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-[background-color,color,scale] duration-fast ease-ui hover:bg-muted hover:text-primary active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
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
                      <p data-card-title className="mt-2 text-center text-sm font-semibold text-card-foreground">
                        {product.name}
                      </p>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>,
              document.body,
            )}
        </div>
      ) : (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 p-5 text-center sm:p-6 lg:p-4">
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
