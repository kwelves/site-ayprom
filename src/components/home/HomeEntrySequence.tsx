"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { DURATION } from "@/lib/motion";
import { cn } from "@/lib/utils";

type HomeEntryPhase = "awaiting-video" | "header" | "content";

interface HomeEntrySequenceValue {
  /** True only after the hero video has produced its first frame. */
  revealHeader: () => void;
  headerVisible: boolean;
  contentVisible: boolean;
}

const HomeEntrySequenceContext = createContext<HomeEntrySequenceValue>({
  revealHeader: () => undefined,
  headerVisible: true,
  contentVisible: true,
});

/**
 * Coordinates the home page's first-view hierarchy without changing the
 * positioning of its layers: video → header → content. Other routes remain
 * visible immediately. The video itself owns the signal so a decoded frame,
 * rather than an arbitrary timeout, starts the sequence.
 */
export function HomeEntrySequence({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const [phase, setPhase] = useState<HomeEntryPhase>(() => (isHome ? "awaiting-video" : "content"));

  useEffect(() => {
    // Layouts persist between App Router navigations. Defer the reset by one
    // frame so it is a navigation-side synchronisation rather than a
    // synchronous effect update, and so the newly mounted hero can supply
    // its decoded-frame signal in the normal order.
    const frame = window.requestAnimationFrame(() => setPhase(isHome ? "awaiting-video" : "content"));
    return () => window.cancelAnimationFrame(frame);
  }, [isHome]);

  const revealHeader = useCallback(() => {
    if (!isHome) return;
    setPhase((current) => (current === "awaiting-video" ? "header" : current));
  }, [isHome]);

  useEffect(() => {
    if (!isHome || phase !== "header") return;

    const timer = window.setTimeout(() => setPhase("content"), DURATION.base * 1000);
    return () => window.clearTimeout(timer);
  }, [isHome, phase]);

  const value = useMemo<HomeEntrySequenceValue>(
    () => ({
      revealHeader,
      headerVisible: !isHome || phase !== "awaiting-video",
      contentVisible: !isHome || phase === "content",
    }),
    [isHome, phase, revealHeader],
  );

  return <HomeEntrySequenceContext.Provider value={value}>{children}</HomeEntrySequenceContext.Provider>;
}

export function useHomeEntrySequence() {
  return useContext(HomeEntrySequenceContext);
}

/** Keeps below-the-fold home content mounted for SEO, layout, and its own
 * observers; only the visual entrance waits for the header's short reveal. */
export function HomeEntryContent({ children, className }: { children: React.ReactNode; className?: string }) {
  const { contentVisible } = useHomeEntrySequence();

  return (
    <div
      aria-hidden={!contentVisible}
      inert={!contentVisible}
      className={cn(
        "transition-[opacity,translate] duration-reveal ease-ui",
        contentVisible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
