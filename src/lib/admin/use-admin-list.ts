"use client";

import { useState, useTransition } from "react";
import { useSaveFlowFlash } from "@/lib/admin/use-save-flow-flash";

interface UseAdminListOptions<T> {
  initial: T[];
  getId: (item: T) => string;
  // Persist the new order (already-mapped ids are handed in). Bind any extra
  // args at the call site, e.g. reorderSubcategories.bind(null, categorySlug).
  reorder: (ids: string[]) => void;
  // Persist a deletion by id. Callers run their own confirm()/guard first and
  // only reach removeItem() when the delete is actually going ahead.
  remove: (id: string) => void;
  messages: { created: string; updated: string };
  flashSlug?: string;
  flashAction?: "created" | "updated";
}

// Shared wiring for every admin entity list (brands / categories / vehicle
// types / subcategories / products): local optimistic item state, the
// reorder-then-persist and optimistic-delete flows, and the save-flow flash
// (toast + row highlight). Each list keeps what's genuinely its own — the
// renderItem markup, per-entity delete guards, subcategory's getFlashKey,
// and the products list's publish toggle (built on the exposed setItems /
// startTransition).
export function useAdminList<T>({
  initial,
  getId,
  reorder,
  remove,
  messages,
  flashSlug,
  flashAction,
}: UseAdminListOptions<T>) {
  const [items, setItems] = useState(initial);
  const [, startTransition] = useTransition();
  const { toast, dismissToast, highlightedKey } = useSaveFlowFlash({ flashKey: flashSlug, flashAction, messages });

  function handleReorder(next: T[]) {
    setItems(next);
    startTransition(() => reorder(next.map(getId)));
  }

  function removeItem(item: T) {
    const id = getId(item);
    setItems((prev) => prev.filter((i) => getId(i) !== id));
    startTransition(() => remove(id));
  }

  return { items, setItems, startTransition, handleReorder, removeItem, toast, dismissToast, highlightedKey };
}
