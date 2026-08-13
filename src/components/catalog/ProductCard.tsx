"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DURATION, EASE_UI } from "@/lib/motion";
import { useIsTouchDevice } from "@/lib/use-is-touch-device";
import { ImageFallback } from "@/components/ui/ImageFallback";
import type { ProductListItem } from "@/types/catalog";

// Как в ProductGallery: уход короче прихода, оба идут одновременно.
const slideVariants = {
  enter: (direction: number) => ({ x: direction > 0 ? 24 : -24, opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { duration: DURATION.base, ease: EASE_UI } },
  exit: (direction: number) => ({
    x: direction > 0 ? -24 : 24,
    opacity: 0,
    transition: { duration: DURATION.fast, ease: EASE_UI },
  }),
};

const SWIPE_THRESHOLD = 40;

// Unlike CategoryCard/BrandCard (which lift + scale on hover), product cards
// use a static hover — only border/shadow change, no transform. In a long
// product grid a moving card under every pointer pass would be visual noise
// while scanning, so the card stays put and just signals "interactive".
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
export function ProductCard({ product, href }: { product: ProductListItem; href: string }) {
  const router = useRouter();
  const [[index, direction], setIndex] = useState<[number, number]>([0, 0]);
  const hasMultiple = product.images.length > 1;
  const currentImage = product.images[index];
  const isTouchDevice = useIsTouchDevice();
  // Framer Motion can still fire onTap right after a drag release when drag
  // and tap gestures share the same element — this flag lets onTap tell a
  // real tap apart from "finger lifted at the end of a swipe".
  const didDragRef = useRef(false);

  const goTo = (nextIndex: number) => {
    if (product.images.length === 0) return;
    const wrapped = (nextIndex + product.images.length) % product.images.length;
    setIndex([wrapped, nextIndex > index ? 1 : -1]);
  };

  const handleArrowClick = (nextIndex: number) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    goTo(nextIndex);
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
      goTo(index + 1);
    } else if (info.offset.x > SWIPE_THRESHOLD) {
      goTo(index - 1);
    }
    // Clear it a tick later so it's still true when onTap checks it (onTap
    // can fire in the same gesture right after onDragEnd), but reset before
    // the next, separate tap.
    requestAnimationFrame(() => {
      didDragRef.current = false;
    });
  };

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-border-interactive hover:shadow-sm">
      <Link
        href={href}
        aria-label={product.name}
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      />

      <motion.div
        className="relative z-10 aspect-square w-full shrink-0 touch-pan-y overflow-hidden bg-muted/40"
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
              alt={product.name}
              sizes="(max-width: 639px) 45vw, (max-width: 1023px) 30vw, 320px"
              quality={60}
              className="p-4"
              style={currentImage?.scale ? { transform: `scale(${currentImage.scale})` } : undefined}
            />
          </motion.div>
        </AnimatePresence>

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={handleArrowClick(index - 1)}
              aria-label="Предыдущее фото"
              className="absolute left-2 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-card/80 text-primary opacity-70 shadow-sm backdrop-blur-sm transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleArrowClick(index + 1)}
              aria-label="Следующее фото"
              className="absolute right-2 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-card/80 text-primary opacity-70 shadow-sm backdrop-blur-sm transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </>
        )}
      </motion.div>

      <div className="flex flex-1 flex-col px-4 pt-4 pb-5">
        <span className="text-sm font-semibold text-card-foreground">{product.name}</span>
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {product.shortDescription}
        </p>
      </div>

      {hasMultiple && (
        <div className="relative z-10 flex items-center justify-center pb-4">
          {product.images.map((image, i) => (
            // p-2 padding around the dot enlarges the actual tap target well
            // past its 6px visual size, without making the indicator itself
            // look oversized — the dot stays small, only the hit area grows.
            <button
              key={`${image.url}-${i}`}
              type="button"
              onClick={handleArrowClick(i)}
              aria-label={`Показать фото ${i + 1}`}
              aria-current={i === index}
              className="p-2"
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
