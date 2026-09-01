"use client";

import Image from "next/image";
import { useReducedMotion } from "framer-motion";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { DURATION } from "@/lib/motion";
import { cn } from "@/lib/utils";

type HomeEntryPhase = "awaiting-video" | "header" | "content";
type BootOverlayPhase = "visible" | "exiting" | "hidden";

// This does not pace the normal entrance. It is only an escape hatch for a
// broken or indefinitely stalled media request, so navigation never remains
// hidden behind the loader.
const HERO_BOOT_SAFETY_TIMEOUT_MS = 5_000;

interface HomeEntrySequenceValue {
  /** True only after the hero video has produced its first frame. */
  revealVideo: () => void;
  revealHeader: () => void;
  /** Hydration-safe route state for server-rendered children of this provider. */
  isHomeRoute: boolean;
  headerVisible: boolean;
  contentVisible: boolean;
}

const HomeEntrySequenceContext = createContext<HomeEntrySequenceValue>({
  revealVideo: () => undefined,
  revealHeader: () => undefined,
  isHomeRoute: false,
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
  const prefersReducedMotion = useReducedMotion();
  // Server Components passed into this Client Component are rendered as
  // slots, so on the server their context consumers see the defaults above.
  // Keep the provider's first client render on those same values, then arm
  // route-specific state before paint while the opaque boot overlay is up.
  const [sequenceArmed, setSequenceArmed] = useState(false);
  const [phase, setPhase] = useState<HomeEntryPhase>(() => (isHome ? "awaiting-video" : "content"));
  const [bootOverlayPhase, setBootOverlayPhase] = useState<BootOverlayPhase>(() => (isHome ? "visible" : "hidden"));
  // This is deliberately a lifetime flag of the shared site layout. App
  // Router layouts persist between route changes, so returning to `/` must
  // never put an already usable site back behind the introductory loader.
  const [initialBootComplete, setInitialBootComplete] = useState(() => !isHome);
  const isInitialHomeBoot = isHome && !initialBootComplete;
  // `usePathname()` is not guaranteed to expose the browser pathname while a
  // route is being prerendered (notably behind Proxy/rewrites on Vercel). Keep
  // every route-dependent DOM change behind the same post-mount gate as the
  // context values so the server shell and first client render stay identical.
  const bootContentLocked = sequenceArmed && isInitialHomeBoot && phase !== "content";

  useLayoutEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSequenceArmed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useLayoutEffect(() => {
    // Mark the lifecycle guard before the next paint after leaving home. A
    // microtask keeps the update out of the effect's synchronous body while
    // still completing before a new user navigation can render `/` again.
    if (isHome || initialBootComplete) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setInitialBootComplete(true);
    });
    return () => {
      cancelled = true;
    };
  }, [initialBootComplete, isHome]);

  const revealVideo = useCallback(() => {
    if (!isInitialHomeBoot) return;
    setBootOverlayPhase((current) => {
      if (current !== "visible") return current;
      return prefersReducedMotion ? "hidden" : "exiting";
    });
  }, [isInitialHomeBoot, prefersReducedMotion]);

  const revealHeader = useCallback(() => {
    if (!isInitialHomeBoot) return;
    revealVideo();
    setPhase((current) => (current === "awaiting-video" ? "header" : current));
  }, [isInitialHomeBoot, revealVideo]);

  useEffect(() => {
    if (bootOverlayPhase !== "exiting") return;

    const timer = window.setTimeout(() => setBootOverlayPhase("hidden"), DURATION.base * 1000 + 80);
    return () => window.clearTimeout(timer);
  }, [bootOverlayPhase]);

  useEffect(() => {
    if (!isInitialHomeBoot || phase !== "awaiting-video") return;

    // A non-animated preference should never be made to wait through an
    // invented stage. The normal path still waits for a decoded frame; this
    // only makes the failure escape hatch immediate for reduced motion.
    const timer = window.setTimeout(revealHeader, prefersReducedMotion ? 0 : HERO_BOOT_SAFETY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [isInitialHomeBoot, phase, prefersReducedMotion, revealHeader]);

  useEffect(() => {
    if (!isInitialHomeBoot || phase !== "header") return;

    const timer = window.setTimeout(() => {
      setInitialBootComplete(true);
      setPhase("content");
    }, prefersReducedMotion ? 0 : DURATION.base * 1000);
    return () => window.clearTimeout(timer);
  }, [isInitialHomeBoot, phase, prefersReducedMotion]);

  const value = useMemo<HomeEntrySequenceValue>(
    () => ({
      revealVideo,
      revealHeader,
      isHomeRoute: sequenceArmed && isHome,
      headerVisible: !sequenceArmed || !isInitialHomeBoot || phase !== "awaiting-video",
      contentVisible: !sequenceArmed || !isInitialHomeBoot || phase === "content",
    }),
    [isHome, isInitialHomeBoot, phase, revealHeader, revealVideo, sequenceArmed],
  );

  return (
    <HomeEntrySequenceContext.Provider value={value}>
      <a
        href="#main-content"
        aria-hidden={bootContentLocked || undefined}
        inert={bootContentLocked}
        className="fixed left-3 top-3 z-[100] -translate-y-24 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg transition-transform focus-visible:translate-y-0"
      >
        Перейти к содержимому
      </a>
      <div
        data-home-entry-content
        aria-hidden={bootContentLocked || undefined}
        inert={bootContentLocked}
        className="contents"
      >
        {children}
      </div>
      {sequenceArmed && isInitialHomeBoot && bootOverlayPhase !== "hidden" && (
        <HomeBootOverlay exiting={bootOverlayPhase === "exiting"} />
      )}
    </HomeEntrySequenceContext.Provider>
  );
}

/**
 * It is mounted inside the same SSR tree as the page rather than supplied by
 * a route-level replacement. Being fixed keeps it entirely out of document
 * flow: when it fades away, the already-laid-out hero does not move and CLS
 * stays at zero for this transition.
 */
function HomeBootOverlay({ exiting }: { exiting: boolean }) {
  return (
    <div
      aria-hidden={exiting}
      className={cn(
        "fixed inset-0 z-[100] flex min-h-dvh items-center justify-center bg-background px-6 transition-opacity duration-base ease-ui",
        exiting && "pointer-events-none opacity-0",
      )}
    >
      <div className="flex w-full max-w-48 flex-col items-center gap-7" role="status">
        <Image
          src="/brand/ayprom-logo.svg"
          alt="AYPROM"
          width={378}
          height={90}
          preload
          unoptimized
          className="w-48 animate-pop-in"
        />
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-strong"
          role="progressbar"
          aria-label="Загрузка сайта"
          aria-valuetext="Загрузка"
        >
          <div className="h-full w-2/5 rounded-full bg-primary animate-site-loading-progress" />
        </div>
      </div>
      <span className="sr-only">Загрузка сайта</span>
    </div>
  );
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
