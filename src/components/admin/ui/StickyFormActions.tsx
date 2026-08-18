import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StickyFormActionsProps {
  children: ReactNode;
  className?: string;
}

// Keeps Save/Cancel/Delete reachable on long, sectioned forms (ProductForm's
// six collapsible sections can scroll well past one screen) without a
// separate mobile-only variant — `sticky` + safe-area padding behaves the
// same on desktop and, thanks to the inset, doesn't sit under the iOS Safari
// home indicator either.
export function StickyFormActions({ children, className }: StickyFormActionsProps) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 -mx-4 flex items-center gap-4 border-t border-border bg-card/95 px-4 py-4 backdrop-blur-sm sm:mx-0 sm:rounded-b-lg",
        className,
      )}
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      {children}
    </div>
  );
}
