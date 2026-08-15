"use client";

import { useState } from "react";
import type { PointerEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { getCardGridSizing } from "@/lib/category-grid";
import { cn } from "@/lib/utils";
import type { Category } from "@/types/catalog";

// Пересобрано по компоненту "Hover Effect"
// (https://21st.dev/@serafimcloud/components/hover-effect): общая подсветка
// с framer-motion `layoutId` "переезжает" к наведённой карточке вместо того,
// чтобы каждая карточка сама поднималась/увеличивалась под курсором. Фото,
// токены цвета и подпись — из прежнего CategoryCard (см.
// _archive/category-section-v1).
export function CategoryHoverGrid({ categories }: { categories: Category[] }) {
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const sizing = getCardGridSizing(categories.length);

  // Только мышь: на тачскрине pointerenter срабатывает от тапа, и подсветка
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
    <StaggerGroup className={cn("mt-8 flex flex-wrap justify-center gap-5", sizing.containerClassName)}>
      {categories.map((category) => (
        <StaggerItem key={category.slug} className={sizing.itemClassName}>
          <Link
            href={`/catalog/category/${category.slug}`}
            onPointerEnter={handlePointerEnter(category.slug)}
            onPointerLeave={handlePointerLeave}
            className="relative block h-full w-full p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.98]"
          >
            <AnimatePresence>
              {hoveredSlug === category.slug && (
                <motion.span
                  layoutId="category-hover-highlight"
                  className="absolute inset-0 z-0 block rounded-2xl bg-primary/10"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.15 } }}
                  exit={{ opacity: 0, transition: { duration: 0.15, delay: 0.2 } }}
                />
              )}
            </AnimatePresence>

            <div className="relative z-10 flex h-full flex-col overflow-hidden rounded-xl border border-primary/10 bg-card">
              <div className="relative aspect-4/3 w-full shrink-0 bg-muted/40">
                <Image
                  src={category.image}
                  alt={category.name}
                  fill
                  sizes="(max-width: 639px) 45vw, (max-width: 1023px) 30vw, 320px"
                  className="object-contain p-5"
                />
              </div>

              <div className="px-4 py-3.5 text-center">
                <span className="text-sm font-medium text-card-foreground">{category.name}</span>
              </div>
            </div>
          </Link>
        </StaggerItem>
      ))}
    </StaggerGroup>
  );
}
