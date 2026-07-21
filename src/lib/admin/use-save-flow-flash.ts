"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

// How long the highlight stays visible once applied — kept short, per the
// brief on this: it's just a "yes, this is the one" flash, not a persistent marker.
const HIGHLIGHT_DURATION_MS = 600;
// Give scrollIntoView's smooth animation a moment to land before flashing,
// so the highlight appears once the item is actually in view rather than
// mid-scroll where the admin might miss it.
const SCROLL_SETTLE_MS = 400;

interface UseSaveFlowFlashOptions {
  // Identifies which item to flash, and whether it was just created or
  // edited — passed down from the page's searchParams (?created=… /
  // ?updated=…) rather than read via useSearchParams, so list pages don't
  // need a Suspense boundary just for this.
  flashKey?: string;
  flashAction?: "created" | "updated";
  messages: { created: string; updated: string };
}

// Shared by every admin list (products/brands/categories/subcategories/
// vehicle types) to drive the "saved!" toast, scroll-into-view, and brief
// highlight flash after a create/edit redirects back to the list. Whether a
// list is short enough that every row is already on-screen (vehicle types)
// or long enough to need scrolling (products) isn't special-cased here —
// scrollIntoView is simply skipped when the target's already visible.
export function useSaveFlowFlash({ flashKey, flashAction, messages }: UseSaveFlowFlashOptions) {
  const router = useRouter();
  const pathname = usePathname();
  const [toast, setToast] = useState<string | null>(null);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!flashKey || !flashAction) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizing from the external ?created=/?updated= query param (a one-shot signal from the redirecting Server Action), not derivable state.
    setToast(flashAction === "created" ? messages.created : messages.updated);
    // Strip ?created=/?updated= so a refresh or back-navigation doesn't replay the flash.
    router.replace(pathname, { scroll: false });

    const target = document.querySelector<HTMLElement>(`[data-flash-key="${CSS.escape(flashKey)}"]`);
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
    if (!isVisible) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    const settleDelay = isVisible ? 0 : SCROLL_SETTLE_MS;
    const showTimer = setTimeout(() => setHighlightedKey(flashKey), settleDelay);
    const hideTimer = setTimeout(() => setHighlightedKey(null), settleDelay + HIGHLIGHT_DURATION_MS);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
    // Re-running this on every router/pathname identity change would re-flash
    // after the replace() above swaps them out — only flashKey/flashAction
    // (and the messages they select) should retrigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashKey, flashAction]);

  return { toast, dismissToast: () => setToast(null), highlightedKey };
}
