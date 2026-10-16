import { useSyncExternalStore } from "react";

// Light or dark admin (design system v2: the moon button switches it and the choice is remembered; the public
// site stays light). The choice lives in this browser only; storage may be unavailable, then light is used.
export type AdminTheme = "light" | "dark";

const STORAGE_KEY = "ayprom-admin-theme";
const ATTRIBUTE = "data-admin-theme";
const CHANGE_EVENT = "ayprom-admin-theme-change";

export function readStoredAdminTheme(): AdminTheme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function currentAdminTheme(): AdminTheme {
  return document.body.getAttribute(ATTRIBUTE) === "dark" ? "dark" : "light";
}

export function applyAdminTheme(theme: AdminTheme, { remember = false }: { remember?: boolean } = {}) {
  if (theme === "dark") document.body.setAttribute(ATTRIBUTE, "dark");
  else document.body.removeAttribute(ATTRIBUTE);
  window.dispatchEvent(new Event(CHANGE_EVENT));
  if (!remember) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The theme still applies for this visit.
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

/** The theme on the page now; "light" while rendering on a server. */
export function useAdminTheme(): AdminTheme {
  return useSyncExternalStore(subscribe, currentAdminTheme, () => "light");
}
