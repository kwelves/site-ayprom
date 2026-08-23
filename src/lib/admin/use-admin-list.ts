"use client";

import { useState, useTransition } from "react";
import { useSaveFlowFlash } from "@/lib/admin/use-save-flow-flash";
import { useAdminToast } from "@/components/admin/ui/AdminToastProvider";

interface UseAdminListOptions<T> {
  initial: T[];
  getId: (item: T) => string;
  // Persist the new order (already-mapped ids are handed in). Bind any extra
  // args at the call site, e.g. reorderSubcategories.bind(null, categorySlug).
  reorder: (ids: string[]) => Promise<void>;
  // Persist a deletion by id. Callers run their own confirm()/guard first and
  // only reach removeItem() when the delete is actually going ahead.
  remove: (id: string) => Promise<void>;
  messages: { created: string; updated: string; deleted: string; reordered: string };
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
  const [serverItems, setServerItems] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const { highlightedKey } = useSaveFlowFlash({ flashKey: flashSlug, flashAction, messages });
  const { success } = useAdminToast();

  // A Server Action can re-render the current route without remounting this
  // Client Component. React deliberately preserves local state in that case,
  // so mirror the new server snapshot explicitly instead of continuing to show
  // rows that were deleted or edited in the database.
  if (initial !== serverItems) {
    setServerItems(initial);
    setItems(initial);
  }

  function handleReorder(next: T[]) {
    const previous = items;
    setItems(next);
    setActionError(null);
    startTransition(async () => {
      try {
        await reorder(next.map(getId));
        success(messages.reordered);
      } catch {
        setItems(previous);
        setActionError("Не удалось сохранить новый порядок. Список возвращён в прежнее состояние.");
      }
    });
  }

  function removeItem(item: T) {
    const id = getId(item);
    const previousIndex = items.findIndex((candidate) => getId(candidate) === id);
    setItems((prev) => prev.filter((i) => getId(i) !== id));
    setActionError(null);
    startTransition(async () => {
      try {
        await remove(id);
        success(messages.deleted);
      } catch {
        // Roll back only this row. Restoring the whole captured array can bring
        // back another item whose overlapping deletion already succeeded.
        setItems((current) => {
          if (current.some((candidate) => getId(candidate) === id)) return current;
          const restored = [...current];
          restored.splice(Math.min(Math.max(previousIndex, 0), restored.length), 0, item);
          return restored;
        });
        setActionError("Не удалось удалить запись. Она возвращена в список.");
      }
    });
  }

  return {
    items,
    setItems,
    isPending,
    startTransition,
    handleReorder,
    removeItem,
    highlightedKey,
    actionError,
    dismissActionError: () => setActionError(null),
    reportActionError: setActionError,
    reportSuccess: success,
  };
}
