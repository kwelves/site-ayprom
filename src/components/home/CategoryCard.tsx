"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { springSnappy } from "@/lib/motion";
import { categoryIconMap } from "@/lib/category-icons";
import { cn } from "@/lib/utils";
import type { Category } from "@/types/catalog";

const MotionLink = motion.create(Link);

export function CategoryCard({ category }: { category: Category }) {
  const Icon = categoryIconMap[category.icon];
  const shouldReduceMotion = useReducedMotion();
  const titleRef = useRef<HTMLSpanElement>(null);
  const [titleWraps, setTitleWraps] = useState(false);

  // Whether the name fits on one line depends on the card's rendered width,
  // which changes per breakpoint — so measure the actual line count instead
  // of guessing from character length. One-line titles center against the
  // icon; wrapped titles keep the top-aligned layout.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;

    const measure = () => {
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
      setTitleWraps(el.offsetHeight > lineHeight * 1.5);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [category.name]);

  return (
    <MotionLink
      href={`/catalog/category/${category.slug}`}
      className="group relative z-0 flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:z-10 hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      whileHover={shouldReduceMotion ? undefined : { scale: 1.05, y: -4 }}
      whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
      transition={springSnappy}
    >
      {/* Photo bleeds to the card's own edges (only a small internal p-2 for breathing
          room around the product itself) so it reads bigger and the card feels fuller.
          Fixed 4:3 ratio matches the source photos exactly (800x600, no letterboxing)
          and object-contain keeps the product fully visible, at rest or mid-hover. */}
      <div className="relative aspect-4/3 w-full shrink-0 bg-muted/40">
        <Image
          src={category.image}
          alt={category.name}
          fill
          sizes="(max-width: 639px) 45vw, (max-width: 1023px) 30vw, 320px"
          className="object-contain p-2"
        />
      </div>

      <div className={cn("flex min-h-10 gap-2.5 px-5 pt-4", titleWraps ? "items-start" : "items-center")}>
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground",
            titleWraps && "mt-0.5"
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span ref={titleRef} className="text-sm leading-snug font-semibold text-card-foreground">
          {category.name}
        </span>
      </div>

      <p className="line-clamp-2 break-words px-5 pt-2 pb-5 text-xs leading-relaxed text-muted-foreground">
        {category.description}
      </p>
    </MotionLink>
  );
}
