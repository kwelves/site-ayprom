"use client";

import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { getCardGridSizing } from "@/lib/category-grid";
import { cn } from "@/lib/utils";
import type { Category } from "@/types/catalog";

interface HighlightRect {
  slug: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Пересобрано по компоненту "Hover Effect"
// (https://21st.dev/@serafimcloud/components/hover-effect): подсветка
// "переезжает" к наведённой карточке вместо того, чтобы каждая карточка
// сама поднималась/увеличивалась под курсором. Фото, токены цвета и подпись
// — из прежнего CategoryCard (см. _archive/category-section-v1).
//
// В отличие от референса подсветка — один постоянный узел с координатами
// из state, а не layoutId + отдельный AnimatePresence на каждой карточке:
// в референсе при переходе между соседними карточками старый узел ещё
// доигрывает exit (с задержкой), пока новый уже стартует enter в другом
// месте — два независимых анимирующихся инстанса дают видимую вспышку.
// Один узел просто едет к новым координатам — тот же "гуляющий квадрат",
// без гонки двух анимаций.
export function CategoryHoverGrid({ categories }: { categories: Category[] }) {
  const [highlight, setHighlight] = useState<HighlightRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizing = getCardGridSizing(categories.length);

  // Только мышь: на тачскрине pointerenter срабатывает от тапа, и подсветка
  // залипала бы на последней нажатой карточке.
  const handlePointerEnter = (slug: string) => (event: PointerEvent<HTMLAnchorElement>) => {
    if (event.pointerType !== "mouse") return;
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const cardRect = event.currentTarget.getBoundingClientRect();
    // Подложка на 5px шире карточки с каждой стороны — сама карточка
    // (её рамка и размер) при этом не трогается.
    const overhang = 5;
    setHighlight({
      slug,
      x: cardRect.left - containerRect.left - overhang,
      y: cardRect.top - containerRect.top - overhang,
      width: cardRect.width + overhang * 2,
      height: cardRect.height + overhang * 2,
    });
  };
  const handlePointerLeave = (event: PointerEvent<HTMLAnchorElement>) => {
    if (event.pointerType !== "mouse") return;
    setHighlight(null);
  };

  return (
    <div ref={containerRef} className="relative mt-8">
      <AnimatePresence>
        {highlight && (
          <motion.span
            key="category-hover-highlight"
            className="pointer-events-none absolute z-0 block rounded-2xl bg-primary/25"
            initial={{ opacity: 0, x: highlight.x, y: highlight.y, width: highlight.width, height: highlight.height }}
            animate={{ opacity: 1, x: highlight.x, y: highlight.y, width: highlight.width, height: highlight.height }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
          />
        )}
      </AnimatePresence>

      <StaggerGroup className={cn("flex flex-wrap justify-center gap-5", sizing.containerClassName)}>
        {categories.map((category) => (
          <StaggerItem key={category.slug} className={sizing.itemClassName}>
            <Link
              href={`/catalog/category/${category.slug}`}
              onPointerEnter={handlePointerEnter(category.slug)}
              onPointerLeave={handlePointerLeave}
              className="relative block h-full w-full p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.98]"
            >
              <div className="relative z-10 flex h-full flex-col overflow-hidden rounded-xl border border-primary/25 bg-card">
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
    </div>
  );
}
