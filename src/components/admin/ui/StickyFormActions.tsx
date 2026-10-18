import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StickyFormActionsProps {
  children: ReactNode;
  className?: string;
}

// Keeps Save/Cancel/Delete reachable on long forms: a floating glass bar that
// sticks 12px above the bottom of the screen (design system v2, dense glass
// over scrolling content). One variant for every screen size; the safe-area
// padding keeps it clear of the iOS Safari home indicator.
export function StickyFormActions({ children, className }: StickyFormActionsProps) {
  return (
    <div
      className={cn(
        "glass-float sticky bottom-3 z-20 mt-5 flex flex-wrap items-center gap-2 rounded-[18px] px-3 py-2.5 sm:gap-3 sm:px-4",
        className,
      )}
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      {children}
    </div>
  );
}
