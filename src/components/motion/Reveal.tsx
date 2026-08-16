"use client";

import { useInViewOnce } from "@/lib/use-in-view-once";
import { cn } from "@/lib/utils";

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

// Появление при прокрутке — обычный CSS-переход по opacity/translate плюс
// IntersectionObserver, а не framer-motion whileInView: чисто-CSS аналог
// (`animation-timeline: view()`) пока только в Chromium, а framer тянет
// клиентский бандл ради того, что делает 15 строк JS.
// Срабатывает один раз (see useInViewOnce), после чего наблюдатель снимается.
// prefers-reduced-motion гасится общим правилом в globals.css (duration до 120ms).
export function Reveal({ children, className, delay = 0 }: RevealProps) {
  const { ref, isInView } = useInViewOnce<HTMLDivElement>({ margin: "-64px" });

  return (
    <div
      ref={ref}
      style={delay ? { transitionDelay: `${delay * 1000}ms` } : undefined}
      className={cn(
        "translate-y-4 opacity-0 transition-[opacity,translate] duration-reveal ease-ui",
        isInView && "translate-y-0 opacity-100",
        className
      )}
    >
      {children}
    </div>
  );
}
