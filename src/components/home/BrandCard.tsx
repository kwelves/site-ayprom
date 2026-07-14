"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Brand } from "@/types/catalog";

const MotionLink = motion.create(Link);

interface BrandCardProps {
  href: string;
  brand: Brand;
  nameClassName?: string;
  imageClassName?: string;
  /** Overrides brand.logoScale for this card's aspect-4/3 box. brand.logoScale
   * is tuned for the small homepage badge (BrandSection) — the same factor
   * can overflow this much bigger box, so callers can pass a box-appropriate
   * value here instead of touching the shared brand data. */
  logoScale?: number;
}

// Mirrors CategoryCard's frame/hover/typography exactly, but renders the logo
// with a plain <img> instead of next/image — next/image blocks local SVGs
// without images.dangerouslyAllowSVG, and brand logos are SVGs.
export function BrandCard({ href, brand, nameClassName, imageClassName, logoScale }: BrandCardProps) {
  const shouldReduceMotion = useReducedMotion();
  const scale = logoScale ?? brand.logoScale;

  return (
    <MotionLink
      href={href}
      className="group relative z-0 flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:z-10 hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      whileHover={shouldReduceMotion ? undefined : { scale: 1.05, y: -4 }}
      whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
      transition={springSnappy}
    >
      <div className="relative aspect-4/3 w-full shrink-0 bg-muted/40">
        {/* Absolute + inset-0 (mirroring next/image's `fill`) instead of a flex
            box with max-h/max-w — a flex child's min-height:auto lets portrait
            or square logos (e.g. KAMAZ, DAF, Mercedes-Benz, Volvo) blow out the
            aspect-4/3 box; absolute positioning can't be pushed by content. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- static local SVGs are already optimal; next/image blocks local SVGs without dangerouslyAllowSVG */}
        <img
          src={brand.logo}
          alt={`Логотип ${brand.name}`}
          className={cn("absolute inset-0 h-full w-full object-contain p-7", imageClassName)}
          style={scale ? { transform: `scale(${scale})` } : undefined}
        />
      </div>

      <div className="px-4 py-3.5 text-center">
        <span className={cn("text-sm font-medium text-card-foreground", nameClassName)}>{brand.name}</span>
      </div>
    </MotionLink>
  );
}
