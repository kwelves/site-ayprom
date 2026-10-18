"use client";

import { useId } from "react";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  /** Tailwind classes applied to the segment when it's the active value —
   * lets callers reuse existing status tokens (success/warning/danger)
   * instead of this primitive inventing its own palette. The background goes
   * to the moving thumb, the text color to the label. */
  activeClassName?: string;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  "aria-label": string;
  disabled?: boolean;
  /** Options share the full width equally at every size (side column of a form). */
  stretch?: boolean;
  className?: string;
}

// Compact fixed-choice control (2-4 options) — used where a <Select> would
// hide the other options behind a click and the choice is made often enough
// that seeing all of them at once matters (product availability in the list
// and in the form).
//
// Design system v2: a glass track; the thumb of the chosen option slides to it
// on a spring instead of the colors jumping between buttons.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
  stretch = false,
  className,
  ...rest
}: SegmentedControlProps<T>) {
  const groupId = useId();
  const reduceMotion = useReducedMotion();
  return (
    <LayoutGroup id={groupId}>
      <div
        role="radiogroup"
        aria-label={rest["aria-label"]}
        className={cn("glass-plate inline-flex h-11 items-stretch gap-0.5 rounded-full p-1 md:h-8", className)}
      >
        {options.map((option) => {
          const active = option.value === value;
          const tone = option.activeClassName ?? "bg-primary text-primary-foreground";
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                "relative min-w-0 flex-1 rounded-full px-3 text-xs font-semibold whitespace-nowrap transition-colors duration-fast ease-ui focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30 md:px-2.5",
                !stretch && "md:flex-none",
                active ? tone.split(" ").filter((name) => name.startsWith("text-")).join(" ") || "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              {active && (
                <motion.span
                  layoutId="segment-thumb"
                  aria-hidden="true"
                  className={cn("absolute inset-0 rounded-full shadow-[inset_0_1px_0_var(--color-glass-highlight)]", tone.split(" ").filter((name) => !name.startsWith("text-")).join(" "))}
                  transition={reduceMotion ? { duration: 0.12 } : { type: "spring", duration: 0.4, bounce: 0.18 }}
                />
              )}
              <span className="relative">{option.label}</span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
