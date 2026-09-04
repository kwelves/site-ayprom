"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, type PanInfo } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  CARD_CAPTION_CLASSNAME,
  CARD_FRAME_CLASSNAME,
  CARD_MEDIA_INSET_CLASSNAME,
  CARD_TITLE_CLASSNAME,
} from "@/lib/card-system";
import { cn } from "@/lib/utils";
import { useIsTouchDevice } from "@/lib/use-is-touch-device";
import {
  GalleryNeighborWarmup,
  PreparedImageLayers,
  usePreparedImageCarousel,
} from "@/components/ui/PreparedImageCarousel";
import type { ProductListItem } from "@/types/catalog";

const SWIPE_THRESHOLD = 40;
const CARD_IMAGE_SIZES = "(max-width: 639px) 45vw, (max-width: 1023px) 30vw, 320px";

// `href` is passed in because the same card links to different nested paths
// depending on whether it's shown under a subcategory grid or a brand grid.
//
// The card itself is a plain div, not a <Link> — with a photo carousel the
// arrow/dot buttons and the swipe gesture must work without triggering
// navigation, and nesting <button>/draggable content inside <a> is invalid
// HTML. Instead an invisible <Link> is stretched over the whole card (a
// "stretched link"); the photo area sits visually on top of it (own z-index,
// since it needs to capture the swipe) and re-implements "tap to open" itself
// via onTap, ignoring taps that land on the arrow buttons.
export function ProductCard({
  product,
  href,
  variant = "default",
}: {
  product: ProductListItem;
  href: string;
  variant?: "default" | "category-grid";
}) {
  const router = useRouter();
  const carousel = usePreparedImageCarousel(product.images);
  const index = carousel.selectedIndex;
  const hasMultiple = product.images.length > 1;
  const isCategoryGrid = variant === "category-grid";
  const isTouchDevice = useIsTouchDevice();
  // Framer Motion can still fire onTap right after a drag release when drag
  // and tap gestures share the same element — this flag lets onTap tell a
  // real tap apart from "finger lifted at the end of a swipe".
  const didDragRef = useRef(false);

  const handleCarouselClick = (action: () => void) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  // drag="x" is used purely for gesture detection, not visual movement:
  // dragConstraints + dragElastic={0} keep the card/arrows rigidly in place
  // (no finger-following wobble) — a swipe behaves like pressing the arrow
  // button, it just triggers goTo() from a different input. Framer Motion
  // still locks onto whichever axis the gesture moves in, so a mostly-
  // vertical touch is left for the page's normal scroll (reinforced by
  // touch-pan-y below).
  const handleDragStart = () => {
    didDragRef.current = true;
  };

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.x < -SWIPE_THRESHOLD) {
      carousel.step(1);
    } else if (info.offset.x > SWIPE_THRESHOLD) {
      carousel.step(-1);
    }
    // Clear it a tick later so it's still true when onTap checks it (onTap
    // can fire in the same gesture right after onDragEnd), but reset before
    // the next, separate tap.
    requestAnimationFrame(() => {
      didDragRef.current = false;
    });
  };

  return (
    <div
      data-hover-border-item
      className={cn(
        "group relative flex h-full flex-col overflow-hidden transition-[box-shadow,scale] duration-fast ease-ui active:scale-[0.98] active:shadow-sm",
        CARD_FRAME_CLASSNAME,
      )}
    >
      <Link
        href={href}
        aria-label={product.name}
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      />

      <motion.div
        className={cn(
          "relative z-10 w-full shrink-0 touch-pan-y overflow-hidden bg-muted/40",
          CARD_MEDIA_INSET_CLASSNAME,
        )}
        drag={hasMultiple && isTouchDevice ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onTap={(event) => {
          if (didDragRef.current) return;
          if ((event.target as HTMLElement).closest("button, a")) return;
          router.push(href);
        }}
      >
        {/* Инсет стоит на зоне выше, а не на <img> — почему именно так,
            расписано в card-system.ts. Здесь 4:3 получает ровно область
            изображения, поэтому её край совпадает с краем текста ниже. */}
        <div className="relative aspect-4/3 w-full">
          <PreparedImageLayers
            images={product.images}
            alt={product.name}
            sizes={CARD_IMAGE_SIZES}
            unoptimized
            layerClassName="absolute inset-0"
            carousel={carousel}
          />
        </div>

        {isCategoryGrid && (
          <span className="absolute left-3 top-3 z-10 rounded-full border border-border bg-card/90 px-2 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
            Товар
          </span>
        )}

        {hasMultiple && carousel.neighborIndices.map((neighborIndex) => (
          <GalleryNeighborWarmup
            key={`${product.images[neighborIndex].url}-${neighborIndex}`}
            url={product.images[neighborIndex].url}
            sizes={CARD_IMAGE_SIZES}
            unoptimized
          />
        ))}

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={handleCarouselClick(() => carousel.step(-1))}
              aria-label="Предыдущее фото"
              className="absolute left-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-card/80 text-primary opacity-70 shadow-sm backdrop-blur-sm transition-[opacity,scale] duration-fast ease-ui hover:opacity-100 active:scale-90 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ChevronLeft aria-hidden="true" className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={handleCarouselClick(() => carousel.step(1))}
              aria-label="Следующее фото"
              className="absolute right-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-card/80 text-primary opacity-70 shadow-sm backdrop-blur-sm transition-[opacity,scale] duration-fast ease-ui hover:opacity-100 active:scale-90 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ChevronRight aria-hidden="true" className="h-5 w-5" />
            </button>
          </>
        )}
      </motion.div>

      <div
        className={cn(
          "flex flex-1 flex-col",
          // Горизонтальный инсет одинаков у обеих разновидностей и равен
          // инсету фото-зоны — текст и фотография стоят на одной вертикали.
          isCategoryGrid ? CARD_CAPTION_CLASSNAME : "px-4 pt-2.5 pb-3 sm:pt-4 sm:pb-5",
        )}
      >
        <span
          data-card-title
          className={cn(
            "text-card-foreground",
            isCategoryGrid ? CARD_TITLE_CLASSNAME : "text-sm font-semibold sm:text-base",
          )}
        >
          {product.name}
        </span>
        {!isCategoryGrid && product.shortDescription && (
          <p className="mt-1.5 line-clamp-2 text-xs leading-4 text-muted-foreground sm:text-sm sm:leading-relaxed">
            {product.shortDescription}
          </p>
        )}
      </div>

      {hasMultiple && !isCategoryGrid && (
        <div className="relative z-10 flex items-center justify-center pb-4">
          {product.images.map((image, i) => (
            // py-[19px] brings the tap target's height to the 44px minimum;
            // horizontal padding stays tighter (px-2) so several dots still
            // fit side by side on a narrow card — the dot stays small, only
            // the hit area grows.
            <button
              key={`${image.url}-${i}`}
              type="button"
              onClick={handleCarouselClick(() => carousel.select(i))}
              aria-label={`Показать фото ${i + 1}`}
              aria-current={i === index}
              className="px-2 py-[19px] transition-transform duration-fast ease-ui active:scale-90"
            >
              {/* Ширина фиксированная, сжимается сама точка — см. ProductGallery. */}
              <span
                className={cn(
                  "block h-1.5 w-4 rounded-full transition-[scale,background-color] duration-fast ease-ui",
                  i === index ? "scale-x-100 bg-primary" : "scale-x-[0.375] bg-border hover:bg-primary-soft"
                )}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
