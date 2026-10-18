"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ImageLightboxProps {
  image: { url: string; fallbackUrl?: string };
  alt: string;
  onClose: () => void;
}

// A plain enlarged photo over a darkened page: no toolbar, no thumbnails. A click anywhere, the cross or Escape
// closes it. It is rendered into <body>: the gallery sits inside a block with an entrance animation, and a
// transformed ancestor would trap a fixed overlay inside that block instead of covering the window.
export function ImageLightbox({ image, alt, onClose }: ImageLightboxProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState(image.url);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      // The cross is the only control, so Tab stays on it.
      if (event.key === "Tab") {
        event.preventDefault();
        closeButtonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      root.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-inverse/85 p-4 backdrop-blur-[2px] motion-safe:animate-[lightbox-fade_180ms_var(--ease-ui)_both] sm:p-10"
    >
      <button
        ref={closeButtonRef}
        type="button"
        onClick={onClose}
        aria-label="Закрыть фото"
        className="absolute top-3 right-3 z-10 grid size-11 place-items-center rounded-full bg-inverse-foreground/15 text-inverse-foreground transition-[background-color,scale] duration-fast ease-ui hover:bg-inverse-foreground/25 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inverse-foreground sm:top-5 sm:right-5"
      >
        <X aria-hidden="true" className="size-6" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- the same pre-built WebP the gallery shows, served as is */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        onError={() => {
          if (image.fallbackUrl && src !== image.fallbackUrl) setSrc(image.fallbackUrl);
        }}
        // Fills the window minus the padding at any source size (object-contain keeps the proportions), so a small
        // photo opens as large as a big one.
        className="size-full object-contain drop-shadow-2xl select-none motion-safe:animate-pop-in"
      />
    </div>,
    document.body,
  );
}
