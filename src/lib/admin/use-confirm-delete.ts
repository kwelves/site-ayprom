"use client";

import { useState } from "react";

// Shared "hold the pending item, confirm, then act" state for every
// list/form delete flow in the admin — extracted once ProductsList/
// ProductForm's unpublish flow proved the pattern, and it turned out to be
// exactly what every other entity's native confirm() should have been
// doing instead (a real dialog, not a browser-chrome confirm() that looks
// nothing like the rest of the product).
export function useConfirmDelete<T>(onConfirmed: (item: T) => void) {
  const [pending, setPending] = useState<T | null>(null);

  return {
    pending,
    request: (item: T) => setPending(item),
    cancel: () => setPending(null),
    confirm: () => {
      if (pending === null) return;
      onConfirmed(pending);
      setPending(null);
    },
  };
}
