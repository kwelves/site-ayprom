"use client";

import dynamic from "next/dynamic";
import { useReducedMotion } from "framer-motion";
import { useInViewOnce } from "@/lib/use-in-view-once";

// three.js is a heavy dependency needed only for this decorative dot-wave.
// Splitting it into its own chunk via next/dynamic keeps it out of every
// page's initial JavaScript — it is fetched only once this component
// actually mounts, which the proximity trigger below delays further still.
const DottedSurface = dynamic(() => import("@/components/ui/DottedSurface"), { ssr: false });

interface FooterBackgroundProps {
  opacity?: number;
}

/**
 * Defers loading the dot-wave's three.js chunk until the footer is close to
 * the viewport, instead of every page paying for it upfront. The 600px
 * bottom margin starts the fetch while the footer is still below the fold,
 * so the effect is already loaded and ready by the time it scrolls into
 * view — same visual result as before, just not paid for on every route.
 */
export function FooterBackground({ opacity }: FooterBackgroundProps) {
  const { ref, isInView } = useInViewOnce<HTMLDivElement>({ margin: "0px 0px 600px 0px" });
  const prefersReducedMotion = useReducedMotion();

  // Reduced-motion visitors never see the animation (DottedSurface itself
  // also bails out), so skip the network request entirely for them.
  if (prefersReducedMotion) return null;

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0">
      {isInView && <DottedSurface opacity={opacity} />}
    </div>
  );
}

export default FooterBackground;
