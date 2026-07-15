"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/catalog";

const slideVariants = {
  enter: (direction: number) => ({ x: direction > 0 ? 24 : -24, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction > 0 ? -24 : 24, opacity: 0 }),
};

// Unlike CategoryCard/BrandCard (which lift + scale on hover), product cards
// use a static hover — only border/shadow change, no transform. In a long
// product grid a moving card under every pointer pass would be visual noise
// while scanning, so the card stays put and just signals "interactive".
// `href` is passed in because the same card links to different nested paths
// depending on whether it's shown under a subcategory grid or a brand grid.
//
// The card itself is a plain div, not a <Link> — with a photo carousel the
// arrow/dot buttons must be clickable without triggering navigation, and
// nesting <button> inside <a> is invalid HTML. Instead an invisible <Link>
// is stretched over the whole card (a "stretched link"); the carousel
// controls sit visually on top of it and stop the click from reaching it.
export function ProductCard({ product, href }: { product: Product; href: string }) {
  const [[index, direction], setIndex] = useState<[number, number]>([0, 0]);
  const hasMultiple = product.images.length > 1;

  const goTo = (nextIndex: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const wrapped = (nextIndex + product.images.length) % product.images.length;
    setIndex([wrapped, nextIndex > index ? 1 : -1]);
  };

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-blue-300 hover:shadow-sm">
      <div className="relative aspect-4/3 w-full shrink-0 bg-muted/40">
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.div
            key={index}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="absolute inset-0"
          >
            <Image
              src={product.images[index]}
              alt={product.name}
              fill
              sizes="(max-width: 639px) 45vw, (max-width: 1023px) 30vw, 320px"
              className="object-contain p-4"
            />
          </motion.div>
        </AnimatePresence>

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={(event) => goTo(index - 1, event)}
              aria-label="Предыдущее фото"
              className="absolute left-2 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-card/80 text-primary opacity-70 shadow-sm backdrop-blur-sm transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={(event) => goTo(index + 1, event)}
              aria-label="Следующее фото"
              className="absolute right-2 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-card/80 text-primary opacity-70 shadow-sm backdrop-blur-sm transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      <div className="flex flex-1 flex-col px-4 pt-4 pb-5">
        <span className="text-sm font-semibold text-card-foreground">{product.name}</span>
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {product.shortDescription}
        </p>
      </div>

      {hasMultiple && (
        <div className="relative z-20 flex items-center justify-center gap-1.5 pb-4">
          {product.images.map((image, i) => (
            <button
              key={`${image}-${i}`}
              type="button"
              onClick={(event) => goTo(i, event)}
              aria-label={`Показать фото ${i + 1}`}
              aria-current={i === index}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index ? "w-4 bg-primary" : "w-1.5 bg-border hover:bg-blue-300"
              )}
            />
          ))}
        </div>
      )}

      <Link
        href={href}
        aria-label={product.name}
        className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      />
    </div>
  );
}
