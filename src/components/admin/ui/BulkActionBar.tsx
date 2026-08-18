"use client";

import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BulkActionBarProps {
  count: number;
  itemLabel: (count: number) => string;
  onClear: () => void;
  children: ReactNode;
  className?: string;
}

// Appears once a list has a non-empty selection — Esc clears the selection
// (PROJECT_BRIEF limits hotkeys to Cmd/Ctrl+S and Esc; this is the Esc case
// outside the product form itself).
export function BulkActionBar({ count, itemLabel, onClear, children, className }: BulkActionBarProps) {
  useEffect(() => {
    if (count === 0) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClear();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [count, onClear]);

  if (count === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label="Массовые действия"
      className={cn(
        "sticky bottom-4 z-20 mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center gap-3 rounded-full border border-border bg-card px-4 py-2.5 shadow-lg",
        className,
      )}
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <span className="text-sm font-medium text-card-foreground">{itemLabel(count)}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <button
        type="button"
        onClick={onClear}
        className="rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-card-foreground"
      >
        Снять выделение
      </button>
    </div>
  );
}
