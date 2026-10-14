"use client";

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { back, forward, navigate, prefetch, refresh, useLocation } from "../router";

// Browser stand-in for `next/navigation`, backed by the admin SPA router.
export { notFound, permanentRedirect, redirect } from "../../admin-worker/shims/next-navigation";

const ParamsContext = createContext<Record<string, string>>({});

export function ParamsProvider({ params, children }: { params: Record<string, string>; children: ReactNode }) {
  return createElement(ParamsContext.Provider, { value: params }, children);
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useContext(ParamsContext) as T;
}

export function usePathname(): string {
  return useLocation().pathname;
}

export function useSearchParams(): URLSearchParams {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

const router = {
  push: (url: string, options?: { scroll?: boolean }) => navigate(url, { scroll: options?.scroll }),
  replace: (url: string, options?: { scroll?: boolean }) => navigate(url, { replace: true, scroll: options?.scroll }),
  back,
  forward,
  refresh,
  prefetch: (url: string) => prefetch(url),
};

export function useRouter() {
  return router;
}
