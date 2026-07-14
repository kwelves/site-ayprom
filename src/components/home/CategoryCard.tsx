"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { springSnappy } from "@/lib/motion";
import type { Category } from "@/types/catalog";

const MotionLink = motion.create(Link);

export function CategoryCard({ category }: { category: Category }) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <MotionLink
      href={`/catalog/category/${category.slug}`}
      className="group relative z-0 flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:z-10 hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      whileHover={shouldReduceMotion ? undefined : { scale: 1.05, y: -4 }}
      whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
      transition={springSnappy}
    >
      {/* Extra internal padding keeps the product smaller within the frame so the
          card reads airier now that it's just a photo + caption. */}
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
    </MotionLink>
  );
}
