"use client";

import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Next.js's own scroll-to-top-on-navigation can silently no-op when the
 * destination page shares an already-mounted layout with the page you're
 * leaving (e.g. /catalog/category/[slug] -> /catalog/category/[slug]/brand/
 * [brandSlug] — both children of the same [slug]/layout.tsx). Since that
 * shared layout doesn't remount, Next sees it as "already in view" and
 * doesn't reset window scroll, so the new (often shorter) page opens still
 * scrolled to wherever the previous page was.
 *
 * This forces scroll-to-top on every plain forward navigation (Link click,
 * router.push) — but NOT on browser back/forward, which BackButton relies on
 * the native History scroll restoration for (see BackButton.tsx). A popstate
 * listener is the only reliable way to tell those two apart here.
 */
export function ResetScrollOnNavigate() {
  const pathname = usePathname();
  const isPopState = useRef(false);

  useLayoutEffect(() => {
    const handlePopState = () => {
      isPopState.current = true;
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useLayoutEffect(() => {
    if (isPopState.current) {
      isPopState.current = false;
      return;
    }
    // Hash links (e.g. /#brands) are handled separately by useHashNavClick /
    // ScrollToHash — only reset here when there's no hash to honor.
    if (window.location.hash) return;
    window.scrollTo({ top: 0, left: 0 });
  }, [pathname]);

  return null;
}
