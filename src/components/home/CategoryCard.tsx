"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";

const MotionLink = motion.create(Link);

interface CategoryCardProps {
  href: string;
  image: string;
  name: string;
  sizes?: string;
  nameClassName?: string;
}

export function CategoryCard({
  href,
  image,
  name,
  sizes = "(max-width: 639px) 45vw, (max-width: 1023px) 30vw, 320px",
  nameClassName,
}: CategoryCardProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <MotionLink
      href={href}
      className="group relative z-0 flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:z-10 hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      whileHover={shouldReduceMotion ? undefined : { scale: 1.05, y: -4 }}
      whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
      transition={springSnappy}
    >
      {/* Extra internal padding keeps the product smaller within the frame so the
          card reads airier now that it's just a photo + caption. */}
      <div className="relative aspect-4/3 w-full shrink-0 bg-muted/40">
        <Image src={image} alt={name} fill sizes={sizes} className="object-contain p-5" />
      </div>

      <div className="px-4 py-3.5 text-center">
        <span className={cn("text-sm font-medium text-card-foreground", nameClassName)}>{name}</span>
      </div>
    </MotionLink>
  );
}
