"use client";

import { useState } from "react";
import type { PointerEvent } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import type { Brand } from "@/types/catalog";

export function BrandHoverGrid({ brands }: { brands: Brand[] }) {
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);

  // Только мышь: на тачскрине pointerenter срабатывает от тапа и подсветка
  // залипала бы на последней нажатой карточке.
  const handlePointerEnter = (slug: string) => (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    setHoveredSlug(slug);
  };
  const handlePointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    setHoveredSlug(null);
  };

  return (
    <StaggerGroup className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
      {brands.map((brand) => (
        <StaggerItem key={brand.slug}>
          <Link
            href={`/catalog/brand/${brand.slug}`}
            onPointerEnter={handlePointerEnter(brand.slug)}
            onPointerLeave={handlePointerLeave}
            className="relative flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card p-3 text-center transition-[border-color,translate,scale] duration-fast ease-ui hover:-translate-y-1 hover:scale-[1.03] hover:border-border-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.98] sm:gap-3 sm:p-4"
          >
            <AnimatePresence>
              {hoveredSlug === brand.slug && (
                <motion.span
                  layoutId="brand-hover-highlight"
                  className="absolute inset-0 z-0 rounded-xl bg-primary/10"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ layout: { type: "spring", bounce: 0.2, duration: 0.5 }, opacity: { duration: 0.15 } }}
                />
              )}
            </AnimatePresence>

            <span className="relative z-10 flex h-10 w-full items-center justify-center sm:h-12">
              {/* eslint-disable-next-line @next/next/no-img-element -- static local SVGs are already optimal; next/image blocks local SVGs without dangerouslyAllowSVG */}
              <img
                src={brand.logo}
                alt={`Логотип ${brand.name}`}
                width={160}
                height={48}
                className="max-h-10 max-w-[80%] object-contain sm:max-h-12"
                style={brand.logoScale ? { transform: `scale(${brand.logoScale})` } : undefined}
              />
            </span>
            <span className="relative z-10 text-xs font-semibold text-card-foreground sm:text-sm">{brand.name}</span>
          </Link>
        </StaggerItem>
      ))}
    </StaggerGroup>
  );
}
