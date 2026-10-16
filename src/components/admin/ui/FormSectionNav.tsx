"use client";

import { useEffect, useId, useState } from "react";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface FormSectionNavItem {
  id: string;
  label: string;
  /** Shown next to the label when the section holds a list (photos, brands, characteristics). */
  count?: number;
}

// The bar over a long form: every part of it by name (with how much is in it), always visible, one click away.
// It follows the reading: the part on screen is marked by a glass thumb that slides along the bar.
export function FormSectionNav({ items, className }: { items: readonly FormSectionNavItem[]; className?: string }) {
  const [activeId, setActiveId] = useState(items[0]?.id);
  const groupId = useId();
  const reduceMotion = useReducedMotion();

  // Re-observe only when the set of parts changes, not on every render of the form (counts change while typing).
  const ids = items.map((item) => item.id).join(",");
  useEffect(() => {
    const sections = ids.split(",").map((id) => document.getElementById(id)).filter((node): node is HTMLElement => node !== null);
    if (sections.length === 0 || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting ? entry.boundingClientRect.top : Infinity);
        let best: string | undefined;
        let bestTop = Infinity;
        for (const [id, top] of visible) {
          if (top !== Infinity && Math.abs(top) < Math.abs(bestTop)) {
            best = id;
            bestTop = top;
          }
        }
        if (best) setActiveId(best);
      },
      // The band just under the sticky bars decides which part is "on screen".
      { rootMargin: "-140px 0px -55% 0px" },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [ids]);

  function go(id: string) {
    setActiveId(id);
    document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  return (
    <LayoutGroup id={groupId}>
      <nav
        aria-label="Разделы формы"
        className={cn(
          "glass-float sticky top-[84px] z-20 flex max-w-full gap-0.5 overflow-x-auto rounded-full p-1 [scrollbar-width:none]",
          className,
        )}
      >
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => go(item.id)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-fast ease-ui focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="form-section-thumb"
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full bg-secondary shadow-[inset_0_1px_0_var(--color-glass-highlight),0_0_0_1px_var(--color-glass-edge)]"
                  transition={reduceMotion ? { duration: 0.12 } : { type: "spring", duration: 0.4, bounce: 0.15 }}
                />
              )}
              <span className="relative">{item.label}</span>
              {item.count !== undefined && (
                <span
                  className={cn(
                    "relative min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold tabular-nums",
                    item.count > 0 ? "bg-accent-strong text-accent-foreground" : "bg-surface-strong text-muted-foreground",
                  )}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}
