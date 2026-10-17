import { useSyncExternalStore } from "react";

// True while the viewport matches the query. Only for layout choices that cannot be made with CSS alone, for
// example when one control must exist in exactly one place of the page (it is a real form field, so a second hidden
// copy would still be submitted). Environments without matchMedia (jsdom) read as "no match".
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}
