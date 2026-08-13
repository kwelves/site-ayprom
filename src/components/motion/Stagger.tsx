"use client";

import { motion } from "framer-motion";
import { fadeUp, staggerContainer } from "@/lib/motion";

interface StaggerGroupProps {
  children: React.ReactNode;
  className?: string;
}

export function StaggerGroup({ children, className }: StaggerGroupProps) {
  return (
    <motion.div
      className={className}
      variants={staggerContainer}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
    >
      {children}
    </motion.div>
  );
}

// Занимается только появлением при прокрутке. Подъёма под курсором здесь
// намеренно нет: Framer держит на этом элементе инлайновый transform от
// варианта `fadeUp`, и CSS-класс с hover его не перебьёт. Интерактивным
// карточкам hover задаётся классами на самой ссылке внутри (см. CategoryCard).
export function StaggerItem({ children, className }: StaggerGroupProps) {
  return (
    <motion.div className={className} variants={fadeUp}>
      {children}
    </motion.div>
  );
}
