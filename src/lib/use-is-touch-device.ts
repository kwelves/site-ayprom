"use client";

import { useSyncExternalStore } from "react";

// (pointer: coarse) reflects the input mechanism (touch vs mouse), not the
// viewport width — a resized desktop browser window still has a fine mouse
// pointer, and some touchscreen laptops are wide. That's the right signal
// for "should swipe-to-change-photo be enabled", not a breakpoint check.
function subscribe(callback: () => void) {
  const query = window.matchMedia("(pointer: coarse)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia("(pointer: coarse)").matches;
}

function getServerSnapshot() {
  return false;
}

export function useIsTouchDevice() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
