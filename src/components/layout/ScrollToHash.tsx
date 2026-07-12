"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Handles the cases useHashNavClick can't: landing on a URL with a hash
 * already in it (hard reload, or a Link navigating in from another page).
 * Runs once per route change and scrolls to the matching section if present.
 */
export function ScrollToHash() {
  const pathname = usePathname();

  useEffect(() => {
    if (!window.location.hash) return;
    const id = window.location.hash.slice(1);

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const raf = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [pathname]);

  return null;
}
