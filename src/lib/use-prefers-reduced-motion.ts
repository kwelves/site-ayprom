"use client";

import { useSyncExternalStore } from "react";

/**
 * Лёгкая замена `useReducedMotion` из framer-motion для раннего shell.
 *
 * Framer тянет за собой весь свой рантайм — ради одного медиазапроса это
 * лишние килобайты и лишняя работа главного потока на первом экране. Здесь
 * тот же контракт, но на `useSyncExternalStore`:
 *
 * - серверный снимок всегда `false`, поэтому первый серверный и первый
 *   клиентский рендер совпадают и гидратация не расходится;
 * - подписка на `matchMedia` даёт реакцию на смену системной настройки без
 *   перезагрузки страницы;
 * - окружения без `matchMedia` (jsdom по умолчанию, старые движки) считаются
 *   «анимация разрешена», как и раньше.
 */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function mediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(REDUCED_MOTION_QUERY);
}

function subscribe(onStoreChange: () => void): () => void {
  const query = mediaQuery();
  if (!query) return () => undefined;
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

function getSnapshot(): boolean {
  return mediaQuery()?.matches ?? false;
}

function getServerSnapshot(): boolean {
  return false;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
