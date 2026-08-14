"use client";

import { motion } from "framer-motion";
import { DURATION, EASE_UI, fadeUp } from "@/lib/motion";

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

// Остаётся на framer-motion: нужен IntersectionObserver (whileInView), а
// чисто-CSS аналог (`animation-timeline: view()`) пока только в Chromium.
// Анимация одноразовая (once: true), после срабатывания аниматор снимается.
//
// prefers-reduced-motion не проверяется здесь вручную: `MotionConfig
// reducedMotion="user"` в MotionPreferences.tsx уже отключает transform-часть
// (`y: 16` из fadeUp) при этой настройке ОС, но оставляет плавный fade по
// opacity — обнулять duration тут значило бы убрать и его тоже.
export function Reveal({ children, className, delay = 0 }: RevealProps) {
  return (
    <motion.div
      className={className}
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-64px" }}
      transition={{ delay, duration: DURATION.reveal, ease: EASE_UI }}
    >
      {children}
    </motion.div>
  );
}
