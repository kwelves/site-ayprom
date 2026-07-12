"use client";

import { motion, useReducedMotion } from "framer-motion";
import { fadeUp, springSnappy, staggerContainer } from "@/lib/motion";

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

interface StaggerItemProps extends StaggerGroupProps {
  /** Adds a hover/tap lift, for interactive cards (links, buttons). */
  hover?: boolean;
}

export function StaggerItem({ children, className, hover }: StaggerItemProps) {
  const shouldReduceMotion = useReducedMotion();
  const canAnimate = hover && !shouldReduceMotion;

  return (
    <motion.div
      className={className}
      variants={fadeUp}
      transition={shouldReduceMotion ? { duration: 0 } : springSnappy}
      whileHover={canAnimate ? { y: -4, scale: 1.02 } : undefined}
      whileTap={canAnimate ? { scale: 0.98 } : undefined}
    >
      {children}
    </motion.div>
  );
}
