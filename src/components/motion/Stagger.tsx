"use client";

import { Children, cloneElement, isValidElement, type ReactElement } from "react";
import { useInViewOnce } from "@/lib/use-in-view-once";
import { cn } from "@/lib/utils";

interface StaggerGroupProps {
  children: React.ReactNode;
  className?: string;
}

interface StaggerItemProps {
  children: React.ReactNode;
  className?: string;
  revealed?: boolean;
  index?: number;
}

// Тот же CSS-переход, что и в Reveal.tsx, только с каскадом: группа держит
// один общий IntersectionObserver и прокидывает `revealed`/`index` в каждый
// StaggerItem как обычные props — framer-motion (whileInView + staggerChildren)
// тут не нужен, каскад — это просто transition-delay = index * 40ms.
// Шаг каскада намеренно мелкий: на сетке каталога бывает два десятка карточек,
// и при большом шаге последняя появлялась бы через секунды после первой.
export function StaggerGroup({ children, className }: StaggerGroupProps) {
  const { ref, isInView } = useInViewOnce<HTMLDivElement>({ margin: "-80px" });

  return (
    <div ref={ref} className={className}>
      {Children.map(children, (child, index) =>
        isValidElement<StaggerItemProps>(child)
          ? cloneElement(child as ReactElement<StaggerItemProps>, { revealed: isInView, index })
          : child
      )}
    </div>
  );
}

export function StaggerItem({ children, className, revealed = false, index = 0 }: StaggerItemProps) {
  return (
    <div
      style={{ transitionDelay: revealed ? `${index * 40}ms` : undefined }}
      className={cn(
        "translate-y-4 opacity-0 transition-[opacity,translate] duration-reveal ease-ui",
        revealed && "translate-y-0 opacity-100",
        className
      )}
    >
      {children}
    </div>
  );
}
