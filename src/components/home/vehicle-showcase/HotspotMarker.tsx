"use client";

import { forwardRef, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type TooltipAlign = "start" | "center" | "end";

// Literal, complete class strings per gap — Tailwind's scanner needs the
// full arbitrary-value class present verbatim in source, so this can't be
// built by interpolating `gap` into a template string at runtime.
const TOOLTIP_GAP_CLASS: Record<9 | 16 | 24 | 32, { below: string; above: string }> = {
  9: { below: "top-[calc(100%+9px)]", above: "bottom-[calc(100%+9px)]" },
  16: { below: "top-[calc(100%+16px)]", above: "bottom-[calc(100%+16px)]" },
  24: { below: "top-[calc(100%+24px)]", above: "bottom-[calc(100%+24px)]" },
  32: { below: "top-[calc(100%+32px)]", above: "bottom-[calc(100%+32px)]" },
};

interface HotspotMarkerProps {
  left: number;
  top: number;
  label: string;
  isActive: boolean;
  /** Which edge has room — computed by the parent from the hotspot's pixel
   * position against the actual stage bounds, since with the vehicle now
   * scaled beyond strict contain-fit a hotspot can sit close to (or past)
   * the stage edge in either axis. */
  tooltipBelow: boolean;
  tooltipAlign: TooltipAlign;
  /** Extra clearance for hotspots so tightly clustered that the default
   * 9px gap still lands the tooltip on a neighboring marker regardless of
   * side/align — see VehicleShowcaseInteractive's per-vehicle placement
   * table. */
  tooltipGap?: 9 | 16 | 24 | 32;
  /** Seconds to wait before popping in, staggered by hotspot number. */
  revealDelay: number;
  onClick: () => void;
}

export const HotspotMarker = forwardRef<HTMLButtonElement, HotspotMarkerProps>(function HotspotMarker(
  { left, top, label, isActive, tooltipBelow, tooltipAlign, tooltipGap = 9, revealDelay, onClick },
  ref,
) {
  const shouldReduceMotion = useReducedMotion();
  const [popped, setPopped] = useState(shouldReduceMotion ?? false);

  useEffect(() => {
    if (shouldReduceMotion) {
      setPopped(true);
      return;
    }
    const timer = setTimeout(() => setPopped(true), revealDelay * 1000);
    return () => clearTimeout(timer);
  }, [revealDelay, shouldReduceMotion]);

  return (
    // Positioning (pixel left/top + the -1/2 translate) lives on this button
    // and nowhere else — see the note in git history on why a framer-motion
    // wrapper around this button breaks CSS containing-block resolution.
    // The entrance here is a plain "zoom out" (starts larger, settles to
    // 1) via CSS transition; Tailwind v4 composes translate + scale
    // utilities into one `transform`, so it combines safely with the
    // centering translate below.
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={isActive}
      className={cn(
        // z-30 on hover/focus/active is the safety net for hotspots too
        // tightly clustered for any placement to fully dodge a neighbor
        // (see VehicleShowcaseInteractive's placement table comment) — it
        // guarantees the tooltip you're actually looking at paints over
        // the marker it happens to overlap, instead of DOM order deciding
        // which one wins.
        "group absolute z-20 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-none transition-[transform,opacity] duration-300 ease-out hover:z-30 focus-visible:z-30 lg:h-8 lg:w-8",
        popped ? "scale-100 opacity-100" : "scale-150 opacity-0",
        isActive && "z-30",
      )}
      style={{ left, top }}
    >
      {!shouldReduceMotion && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[-8px] rounded-full border border-[rgba(120,170,250,0.4)] lg:inset-[-5px]"
          animate={{ scale: [0.72, 1.75], opacity: [0.55, 0] }}
          transition={{ duration: 1.9, repeat: Number.POSITIVE_INFINITY, ease: "easeOut" }}
        />
      )}

      <span
        className={cn(
          "grid h-11 w-11 place-items-center rounded-full border transition-[transform,background-color,box-shadow] duration-150 ease-out lg:h-8 lg:w-8",
          isActive
            ? "scale-[1.08] border-white/28 bg-[#0a5edd] shadow-[0_0_0_8px_rgba(79,145,248,0.16),0_10px_24px_rgba(2,6,24,0.34)]"
            : "border-white/28 bg-[#084bb9] shadow-[0_0_0_0_rgba(79,145,248,0.35),0_8px_18px_rgba(2,6,24,0.28)] group-hover:scale-[1.08] group-hover:bg-[#0a5edd] group-hover:shadow-[0_0_0_8px_rgba(79,145,248,0.16),0_10px_24px_rgba(2,6,24,0.34)] group-focus-visible:scale-[1.08] group-focus-visible:bg-[#0a5edd] group-focus-visible:shadow-[0_0_0_8px_rgba(79,145,248,0.16),0_10px_24px_rgba(2,6,24,0.34)]",
        )}
      >
        {/* "+" only turns into "×" once this hotspot is the active one —
            hovering (unselected) never rotates it, that would make "you can
            click this again to close" look like "this is already open". */}
        <Plus
          aria-hidden="true"
          className={cn("h-[18px] w-[18px] text-white transition-transform duration-150 ease-out lg:h-[13px] lg:w-[13px]", isActive && "rotate-45")}
          strokeWidth={1.8}
        />
      </span>

      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute hidden max-w-[180px] rounded-md border border-white/10 bg-[rgba(15,23,43,0.9)] px-[9px] py-[7px] text-[11px] leading-[1.2] whitespace-nowrap text-white opacity-0 transition-[opacity,transform] duration-150 ease-out sm:block",
          TOOLTIP_GAP_CLASS[tooltipGap][tooltipBelow ? "below" : "above"],
          tooltipAlign === "center" && "left-1/2 -translate-x-1/2",
          tooltipAlign === "start" && "left-0",
          tooltipAlign === "end" && "right-0",
          tooltipBelow ? "translate-y-[-5px] group-hover:translate-y-0 group-focus-visible:translate-y-0" : "translate-y-[5px] group-hover:translate-y-0 group-focus-visible:translate-y-0",
          "group-hover:opacity-100 group-focus-visible:opacity-100",
          isActive && "opacity-100 translate-y-0",
        )}
      >
        {label}
        <span
          aria-hidden="true"
          className={cn(
            "absolute h-2 w-2 rotate-45 border-[rgba(255,255,255,0.1)] bg-[rgba(15,23,43,0.9)]",
            tooltipBelow ? "top-[-4px] border-t border-l" : "bottom-[-4px] border-r border-b",
            tooltipAlign === "center" && "left-1/2 -translate-x-1/2",
            tooltipAlign === "start" && "left-[18px]",
            tooltipAlign === "end" && "right-[18px]",
          )}
        />
      </span>
    </button>
  );
});
