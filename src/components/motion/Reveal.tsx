"use client";

import { motion, useReducedMotion } from "framer-motion";
import { DURATION, EASE_UI, fadeUp } from "@/lib/motion";

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

// Остаётся на framer-motion: нужен IntersectionObserver (whileInView), а
// чисто-CSS аналог (`animation-timeline: view()`) пока только в Chromium.
// Анимация одноразовая (once: true), после срабатывания аниматор снимается.
export function Reveal({ children, className, delay = 0 }: RevealProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-64px" }}
      transition={
        shouldReduceMotion ? { duration: 0 } : { delay, duration: DURATION.reveal, ease: EASE_UI }
      }
    >
      {children}
    </motion.div>
  );
}
