"use client";

import { usePathname } from "next/navigation";

/**
 * Next.js Link's built-in hash scrolling is unreliable for same-page
 * anchor navigation (doesn't fire on repeat clicks, and wasn't firing even
 * on the first click in testing). This bypasses it entirely: same-page hash
 * links scroll manually via scrollIntoView, independent of Link/router state.
 *
 * Also covers the plain (no-hash) case — e.g. clicking "Главная" (href="/")
 * while already on "/". Next.js Link is a no-op when the target path matches
 * the current path (no navigation happens), so without this the click would
 * silently do nothing instead of scrolling back to the top.
 */
export function useHashNavClick() {
  const pathname = usePathname();

  return (href: string, event: React.MouseEvent) => {
    const hashIndex = href.indexOf("#");
    const targetPath = hashIndex === -1 ? href : href.slice(0, hashIndex) || "/";
    if (targetPath !== pathname) return;

    event.preventDefault();
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = prefersReducedMotion ? "auto" : "smooth";

    if (hashIndex === -1) {
      window.scrollTo({ top: 0, behavior });
      if (window.location.hash) {
        window.history.pushState(null, "", href);
      }
      return;
    }

    const id = href.slice(hashIndex + 1);
    document.getElementById(id)?.scrollIntoView({ behavior, block: "start" });

    if (window.location.hash !== `#${id}`) {
      window.history.pushState(null, "", href);
    }
  };
}
