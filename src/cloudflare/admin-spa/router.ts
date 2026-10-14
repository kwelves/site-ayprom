import { useSyncExternalStore } from "react";

// A very small History-API router: the admin has ~25 pages and no nested data loading,
// so there is no need for a framework router. State = current URL + a refresh counter.
export interface RouterLocation {
  pathname: string;
  search: string;
  refreshTick: number;
}

let snapshot: RouterLocation = {
  pathname: typeof window === "undefined" ? "/" : window.location.pathname,
  search: typeof window === "undefined" ? "" : window.location.search,
  refreshTick: 0,
};
const listeners = new Set<() => void>();
let prefetcher: ((url: string) => void) | null = null;

function emit(next: Partial<RouterLocation>): void {
  snapshot = { ...snapshot, ...next };
  for (const listener of [...listeners]) listener();
}

export interface NavigateOptions {
  replace?: boolean;
  scroll?: boolean;
}

export function navigate(url: string, options: NavigateOptions = {}): void {
  const target = new URL(url, window.location.origin);
  if (target.origin !== window.location.origin || !target.pathname.startsWith("/admin")) {
    window.location.assign(url);
    return;
  }
  const full = `${target.pathname}${target.search}${target.hash}`;
  if (options.replace) window.history.replaceState(null, "", full);
  else window.history.pushState(null, "", full);
  emit({ pathname: target.pathname, search: target.search });
  if (options.scroll !== false && !options.replace) window.scrollTo(0, 0);
}

export function back(): void { window.history.back(); }
export function forward(): void { window.history.forward(); }

/** Re-run the current page's data reads (what Next's router.refresh() does). */
export function refresh(): void { emit({ refreshTick: snapshot.refreshTick + 1 }); }

export function setPrefetcher(next: ((url: string) => void) | null): void { prefetcher = next; }
export function prefetch(url: string): void { prefetcher?.(url); }

export function getLocation(): RouterLocation { return snapshot; }

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLocation(): RouterLocation {
  return useSyncExternalStore(subscribe, getLocation, getLocation);
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => emit({ pathname: window.location.pathname, search: window.location.search }));
}
