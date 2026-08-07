"use client";

import { useEffect } from "react";
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
 *
 * Cross-page hash links (e.g. clicking "Спецтехника" in the header while on
 * /catalog, href="/#vehicle-showcase") take a different path entirely: the
 * click handler below only runs its scroll logic when `targetPath ===
 * pathname`, so for a different page it does nothing and just lets Link's
 * normal navigation happen — landing on the right URL (hash included) but
 * not actually scrolled there, same unreliability as the comment above,
 * just one level up. The effect fixes that: it runs whenever `pathname`
 * changes (i.e. after a client-side navigation completes) and, if the new
 * URL has a hash, scrolls to it manually. It only fires on pathname change
 * (not on every render), so it never fires for a same-page hash click
 * (pathname doesn't change there) and never double-scrolls against the
 * click handler.
 */
export function useHashNavClick() {
  const pathname = usePathname();

  useEffect(() => {
    if (!window.location.hash) return;
    const id = window.location.hash.slice(1);

    const scrollToTarget = (target: HTMLElement) => {
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
    };

    const existing = document.getElementById(id);
    if (existing) {
      scrollToTarget(existing);
      return;
    }

    // Landing page's target section can still be streaming in (async
    // server components, e.g. VehicleShowcaseSection's Supabase fetch)
    // right after a cross-page navigation — watch for it instead of
    // guessing a fixed delay.
    const observer = new MutationObserver(() => {
      const target = document.getElementById(id);
      if (target) {
        scrollToTarget(target);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

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
