"use client";

import { cn } from "@/lib/utils";

interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  /** Tailwind classes applied to the segment when it's the active value —
   * lets callers reuse existing status tokens (success/warning/danger)
   * instead of this primitive inventing its own palette. */
  activeClassName?: string;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  "aria-label": string;
  disabled?: boolean;
  className?: string;
}

// Compact fixed-choice control (2-4 options) — used where a <Select> would
// hide the other options behind a click and the choice is made often enough
// that seeing all of them at once matters (product availability in the list
// and in the form).
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
  className,
  ...rest
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={rest["aria-label"]}
      className={cn("inline-flex flex-wrap gap-1 rounded-full border border-border bg-muted/40 p-1", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-fast ease-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
              active
                ? (option.activeClassName ?? "bg-primary text-primary-foreground")
                : "text-muted-foreground hover:text-card-foreground",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
