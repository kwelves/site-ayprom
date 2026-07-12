"use client";

import { usePathname } from "next/navigation";

/**
 * Next.js Link's built-in hash scrolling is unreliable for same-page
 * anchor navigation (doesn't fire on repeat clicks, and wasn't firing even
 * on the first click in testing). This bypasses it entirely: same-page hash
 * links scroll manually via scrollIntoView, independent of Link/router state.
 */
export function useHashNavClick() {
  const pathname = usePathname();

  return (href: string, event: React.MouseEvent) => {
    const hashIndex = href.indexOf("#");
    if (hashIndex === -1) return;

    const targetPath = href.slice(0, hashIndex) || "/";
    const id = href.slice(hashIndex + 1);
    if (targetPath !== pathname) return;

    event.preventDefault();

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    });

    if (window.location.hash !== `#${id}`) {
      window.history.pushState(null, "", href);
    }
  };
}
