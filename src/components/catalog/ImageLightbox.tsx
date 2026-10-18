"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface LightboxImage {
  url: string;
  fallbackUrl?: string;
}

interface ImageLightboxProps {
  images: LightboxImage[];
  startIndex: number;
  alt: string;
  /** Called with the photo that was on screen, so the gallery can stay on it. */
  onClose: (lastIndex: number) => void;
}

const SWIPE_THRESHOLD = 50;

const roundButtonClassName =
  "grid place-items-center rounded-full bg-inverse-foreground/15 text-inverse-foreground transition-[background-color,scale] duration-fast ease-ui hover:bg-inverse-foreground/25 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inverse-foreground";

// One photo of the lightbox. Keyed by its position, so switching starts a fresh short fade and a fresh fallback.
function LightboxPhoto({ image, alt }: { image: LightboxImage; alt: string }) {
  const [src, setSrc] = useState(image.url);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the same pre-built WebP the gallery shows, served as is
    <img
      src={src}
      alt={alt}
      draggable={false}
      onError={() => {
        if (image.fallbackUrl && src !== image.fallbackUrl) setSrc(image.fallbackUrl);
      }}
      // Fills the window minus the padding at any source size (object-contain keeps the proportions), so a small
      // photo opens as large as a big one.
      className="size-full object-contain drop-shadow-2xl select-none motion-safe:animate-[lightbox-fade_160ms_var(--ease-ui)_both]"
    />
  );
}

// A plain enlarged photo over a darkened page: a cross in the corner and, when there are several photos, quiet
// arrows on the sides (also the arrow keys and a swipe on a phone). A click anywhere else, the cross or Escape
// closes it. It is rendered into <body>: the gallery sits inside a block with an entrance animation, and a
// transformed ancestor would trap a fixed overlay inside that block instead of covering the window.
export function ImageLightbox({ images, startIndex, alt, onClose }: ImageLightboxProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [index, setIndex] = useState(startIndex);
  const hasMultiple = images.length > 1;
  const touchStartXRef = useRef<number | null>(null);
  const swipedAtRef = useRef(0);

  const step = useCallback(
    (direction: 1 | -1) => setIndex((current) => (current + direction + images.length) % images.length),
    [images.length],
  );
  const close = useCallback(() => onClose(index), [onClose, index]);

  // Once per opening: lock the page scroll, focus the cross, and give both back on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    return () => {
      root.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
      else if (event.key === "ArrowLeft" && hasMultiple) step(-1);
      else if (event.key === "ArrowRight" && hasMultiple) step(1);
      else if (event.key === "Tab") {
        // Focus stays inside: the cross and the arrows are the only controls.
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
        if (controls.length === 0) return;
        event.preventDefault();
        const current = controls.indexOf(document.activeElement as HTMLButtonElement);
        const next = (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
        controls[next].focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close, hasMultiple, step]);

  function handleBackdropClick() {
    // A swipe on a phone ends with a click too; it only changes the photo.
    if (Date.now() - swipedAtRef.current < 400) return;
    close();
  }

  function handleArrowClick(event: MouseEvent, direction: 1 | -1) {
    event.stopPropagation();
    step(direction);
  }

  function handleTouchStart(event: TouchEvent) {
    touchStartXRef.current = event.touches.length === 1 ? event.touches[0].clientX : null;
  }

  function handleTouchEnd(event: TouchEvent) {
    const startX = touchStartXRef.current;
    touchStartXRef.current = null;
    if (startX === null || !hasMultiple) return;
    const deltaX = event.changedTouches[0].clientX - startX;
    if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;
    swipedAtRef.current = Date.now();
    step(deltaX < 0 ? 1 : -1);
  }

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={handleBackdropClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className={cn(
        "fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-inverse/85 px-4 py-14 backdrop-blur-[2px] motion-safe:animate-[lightbox-fade_180ms_var(--ease-ui)_both] sm:py-12",
        hasMultiple ? "sm:px-24" : "sm:px-10",
      )}
    >
      <button
        ref={closeButtonRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          close();
        }}
        aria-label="Закрыть фото"
        className={cn(roundButtonClassName, "absolute top-3 right-3 z-10 size-11 sm:top-5 sm:right-5")}
      >
        <X aria-hidden="true" className="size-6" />
      </button>

      <div className="size-full motion-safe:animate-pop-in">
        <LightboxPhoto key={index} image={images[index]} alt={alt} />
      </div>

      {hasMultiple && (
        <>
          <button
            type="button"
            onClick={(event) => handleArrowClick(event, -1)}
            aria-label="Предыдущее фото"
            className={cn(roundButtonClassName, "absolute top-1/2 left-2 z-10 size-11 -translate-y-1/2 sm:left-6 sm:size-12")}
          >
            <ChevronLeft aria-hidden="true" className="size-6" />
          </button>
          <button
            type="button"
            onClick={(event) => handleArrowClick(event, 1)}
            aria-label="Следующее фото"
            className={cn(roundButtonClassName, "absolute top-1/2 right-2 z-10 size-11 -translate-y-1/2 sm:right-6 sm:size-12")}
          >
            <ChevronRight aria-hidden="true" className="size-6" />
          </button>
          <p
            aria-live="polite"
            className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-inverse-foreground/15 px-3 py-1 text-sm font-medium text-inverse-foreground tabular-nums"
          >
            {index + 1} из {images.length}
          </p>
        </>
      )}
    </div>,
    document.body,
  );
}
