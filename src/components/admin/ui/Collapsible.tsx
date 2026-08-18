"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface CollapsibleProps {
  title: string;
  description?: string;
  /** Uncontrolled initial state — sections default open on desktop-length
   * forms and closed on mobile via the caller's own `defaultOpen` choice
   * (see ProductForm's section defaults), not detected here. */
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

// Managed height transition instead of native <details> — so it can animate
// with the project's own easing/duration tokens (see globals.css's comment
// on `--transition-duration-slow` being for exactly this: "изменение
// высоты, крупные перемещения") instead of the browser's abrupt toggle.
export function Collapsible({ title, description, defaultOpen = true, children, className }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <section className={cn("rounded-lg border border-border bg-card", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
      >
        <span>
          <span className="block text-sm font-semibold text-card-foreground">{title}</span>
          {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-base ease-ui",
            open && "rotate-180",
          )}
        />
      </button>
      <div
        id={panelId}
        ref={contentRef}
        className={cn(
          "grid transition-[grid-template-rows] duration-slow ease-ui",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-6 px-4 pb-5 pt-1">{children}</div>
        </div>
      </div>
    </section>
  );
}
