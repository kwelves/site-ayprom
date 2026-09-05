"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { HighlightRect } from "@/components/motion/HoverBorderGrid";
import { DURATION } from "@/lib/motion";

const HOVER_TRANSITION = { type: "spring", bounce: 0.2, duration: 0.5 } as const;

export interface HoverBorderHighlightProps {
  highlight: HighlightRect | null;
}

/**
 * Точная framer-motion анимация из e2d468c. Она вынесена в отдельный чанк,
 * чтобы вернуть прежнюю пружину, не возвращая весь Framer в первый экран.
 */
export function HoverBorderHighlight({ highlight }: HoverBorderHighlightProps) {
  const shouldReduceMotion = useReducedMotion();
  const transition = shouldReduceMotion || highlight?.instant ? { duration: 0 } : HOVER_TRANSITION;

  return (
    <AnimatePresence>
      {highlight && (
        <motion.span
          key="card-hover-highlight"
          data-hover-border-highlight
          aria-hidden="true"
          className="pointer-events-none absolute z-0 block rounded-2xl bg-card-hover-highlight"
          initial={{
            opacity: 0,
            x: highlight.x,
            y: highlight.y,
            width: highlight.width,
            height: highlight.height,
          }}
          animate={{
            opacity: 1,
            x: highlight.x,
            y: highlight.y,
            width: highlight.width,
            height: highlight.height,
          }}
          exit={{ opacity: 0, transition: { duration: shouldReduceMotion ? 0 : DURATION.fast } }}
          transition={transition}
        />
      )}
    </AnimatePresence>
  );
}
