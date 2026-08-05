"use client";

import { forwardRef, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface HotspotMarkerProps {
  xPct: number;
  yPct: number;
  label: string;
  isActive: boolean;
  /** Seconds to wait before popping in, staggered by hotspot number. */
  revealDelay: number;
  onClick: () => void;
}

export const HotspotMarker = forwardRef<HTMLButtonElement, HotspotMarkerProps>(function HotspotMarker(
  { xPct, yPct, label, isActive, revealDelay, onClick },
  ref,
) {
  const shouldReduceMotion = useReducedMotion();
  const tooltipBelow = yPct < 16;
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
    // Positioning (left/top % + the -1/2 translate) lives on this button and
    // nowhere else. Tailwind v4 composes translate/scale utilities into one
    // `transform` via shared CSS variables, so the entrance `scale-50` here
    // combines safely with the centering translate — unlike a framer-motion
    // wrapper, whose own inline `transform` would either override this
    // translate outright or (if used on an ancestor instead) turn that
    // ancestor into a new containing block and break the % positioning of
    // this button entirely. Both were tried and both broke; plain CSS
    // transitions avoid the whole class of bug.
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={isActive}
      className={cn(
        "group absolute z-20 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-none transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
        popped ? "scale-100 opacity-100" : "scale-50 opacity-0",
      )}
      style={{ left: `${xPct}%`, top: `${yPct}%` }}
    >
      {!shouldReduceMotion && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[-8px] rounded-full border border-[rgba(120,170,250,0.4)]"
          animate={{ scale: [0.72, 1.75], opacity: [0.55, 0] }}
          transition={{ duration: 1.9, repeat: Number.POSITIVE_INFINITY, ease: "easeOut" }}
        />
      )}

      <span
        className={cn(
          "grid h-11 w-11 place-items-center rounded-full border transition-[transform,background-color,box-shadow] duration-150 ease-out",
          isActive
            ? "scale-[1.08] border-white/28 bg-[#0a5edd] shadow-[0_0_0_8px_rgba(79,145,248,0.16),0_10px_24px_rgba(2,6,24,0.34)]"
            : "border-white/28 bg-[#084bb9] shadow-[0_0_0_0_rgba(79,145,248,0.35),0_8px_18px_rgba(2,6,24,0.28)] group-hover:scale-[1.08] group-hover:bg-[#0a5edd] group-hover:shadow-[0_0_0_8px_rgba(79,145,248,0.16),0_10px_24px_rgba(2,6,24,0.34)] group-focus-visible:scale-[1.08] group-focus-visible:bg-[#0a5edd] group-focus-visible:shadow-[0_0_0_8px_rgba(79,145,248,0.16),0_10px_24px_rgba(2,6,24,0.34)]",
        )}
      >
        <Plus
          aria-hidden="true"
          className={cn(
            "h-[18px] w-[18px] text-white transition-transform duration-150 ease-out",
            isActive ? "rotate-45" : "group-hover:rotate-45 group-focus-visible:rotate-45",
          )}
          strokeWidth={1.8}
        />
      </span>

      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 hidden max-w-[180px] -translate-x-1/2 rounded-md border border-white/10 bg-[rgba(15,23,43,0.9)] px-[9px] py-[7px] text-[11px] leading-[1.2] whitespace-nowrap text-white opacity-0 transition-[opacity,transform] duration-150 ease-out sm:block",
          tooltipBelow
            ? "top-[calc(100%+9px)] translate-y-[-5px] group-hover:translate-y-0 group-focus-visible:translate-y-0"
            : "bottom-[calc(100%+9px)] translate-y-[5px] group-hover:translate-y-0 group-focus-visible:translate-y-0",
          "group-hover:opacity-100 group-focus-visible:opacity-100",
          isActive && "opacity-100 translate-y-0",
        )}
      >
        {label}
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-[rgba(255,255,255,0.1)] bg-[rgba(15,23,43,0.9)]",
            tooltipBelow ? "top-[-4px] border-t border-l" : "bottom-[-4px] border-r border-b",
          )}
        />
      </span>
    </button>
  );
});
