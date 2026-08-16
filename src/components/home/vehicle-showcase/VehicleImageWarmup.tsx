"use client";

import { getImageProps } from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface VehicleImageWarmupCandidate {
  slug: string;
  image: string;
  naturalWidth: number;
  naturalHeight: number;
}

interface VehicleImageWarmupProps {
  candidates: VehicleImageWarmupCandidate[];
  defaultSlug: string;
  /** The visible scene is stable and can spare an idle slot. */
  enabled: boolean;
  sizes: string;
}

interface NetworkConnection {
  effectiveType?: "slow-2g" | "2g" | "3g" | "4g";
  saveData?: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkConnection;
}

const ACTIVITY_COOLDOWN_MS = 750;
const WARMUP_SAFETY_TIMEOUT_MS = 15_000;

function hasConstrainedConnection() {
  if (typeof navigator === "undefined") return true;
  const connection = (navigator as NavigatorWithConnection).connection;
  // Be deliberately conservative: an absent or partial Network Information
  // signal is not permission to spend background bandwidth. Only a browser
  // that explicitly reports 4G and `saveData: false` may enter the queue.
  return !connection || connection.effectiveType !== "4g" || connection.saveData !== false;
}

/**
 * Warms the same optimized `next/image` URLs that the large stage uses —
 * never the original PNGs. The queue deliberately owns only one hidden img
 * at a time and removes that element on real interaction. The browser may
 * retain bytes already transferred in cache, but no further queued image is
 * mounted while scrolling, hotspot choreography, or a vehicle transition is
 * in progress.
 */
export function VehicleImageWarmup({ candidates, defaultSlug, enabled, sizes }: VehicleImageWarmupProps) {
  const queue = useMemo(() => candidates.filter((candidate) => candidate.slug !== defaultSlug), [candidates, defaultSlug]);
  const [cursor, setCursor] = useState(0);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [pausedForActivity, setPausedForActivity] = useState(false);
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  const [hasConstrainedNetwork, setHasConstrainedNetwork] = useState(hasConstrainedConnection);
  const idleHandleRef = useRef<number | null>(null);
  const usesNativeIdleCallbackRef = useRef(false);
  const cooldownTimerRef = useRef<number | null>(null);
  const warmupSafetyTimerRef = useRef<number | null>(null);

  const clearScheduledWork = useCallback(() => {
    if (idleHandleRef.current === null) return;
    if (usesNativeIdleCallbackRef.current) {
      window.cancelIdleCallback?.(idleHandleRef.current);
    } else {
      window.clearTimeout(idleHandleRef.current);
    }
    idleHandleRef.current = null;
  }, []);

  const clearWarmupSafetyTimer = useCallback(() => {
    if (warmupSafetyTimerRef.current !== null) {
      window.clearTimeout(warmupSafetyTimerRef.current);
      warmupSafetyTimerRef.current = null;
    }
  }, []);

  const advance = useCallback(() => {
    clearWarmupSafetyTimer();
    setActiveSlug(null);
    setCursor((current) => current + 1);
  }, [clearWarmupSafetyTimer]);

  useEffect(() => {
    const updateNetworkState = () => setHasConstrainedNetwork(hasConstrainedConnection());
    const connection = (navigator as NavigatorWithConnection).connection;
    connection?.addEventListener?.("change", updateNetworkState);
    return () => connection?.removeEventListener?.("change", updateNetworkState);
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      const visible = document.visibilityState === "visible";
      setIsDocumentVisible(visible);
      if (!visible) {
        clearScheduledWork();
        clearWarmupSafetyTimer();
        setActiveSlug(null);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [clearScheduledWork, clearWarmupSafetyTimer]);

  useEffect(() => {
    const pauseForActivity = () => {
      clearScheduledWork();
      clearWarmupSafetyTimer();
      setActiveSlug(null);
      setPausedForActivity(true);
      if (cooldownTimerRef.current !== null) window.clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = window.setTimeout(() => {
        cooldownTimerRef.current = null;
        setPausedForActivity(false);
      }, ACTIVITY_COOLDOWN_MS);
    };

    // `scroll` catches keyboard/touch scrolling; `wheel` and pointer input
    // stop an in-flight warmup before the scroll event has a chance to fire.
    const eventOptions: AddEventListenerOptions = { passive: true };
    window.addEventListener("pointerdown", pauseForActivity, eventOptions);
    window.addEventListener("touchstart", pauseForActivity, eventOptions);
    window.addEventListener("wheel", pauseForActivity, eventOptions);
    window.addEventListener("scroll", pauseForActivity, eventOptions);
    window.addEventListener("keydown", pauseForActivity);

    return () => {
      window.removeEventListener("pointerdown", pauseForActivity, eventOptions);
      window.removeEventListener("touchstart", pauseForActivity, eventOptions);
      window.removeEventListener("wheel", pauseForActivity, eventOptions);
      window.removeEventListener("scroll", pauseForActivity, eventOptions);
      window.removeEventListener("keydown", pauseForActivity);
      if (cooldownTimerRef.current !== null) window.clearTimeout(cooldownTimerRef.current);
    };
  }, [clearScheduledWork, clearWarmupSafetyTimer]);

  const canWarm = enabled && isDocumentVisible && !hasConstrainedNetwork && !pausedForActivity;
  const candidate = queue[cursor];

  useEffect(() => {
    clearScheduledWork();
    if (!canWarm || !candidate || activeSlug !== null) return;

    let cancelled = false;
    const start = () => {
      idleHandleRef.current = null;
      if (cancelled || document.visibilityState !== "visible" || hasConstrainedConnection()) return;
      setActiveSlug(candidate.slug);
    };

    if ("requestIdleCallback" in window && typeof window.requestIdleCallback === "function") {
      usesNativeIdleCallbackRef.current = true;
      // No timeout: on supported browsers this work must remain genuinely
      // idle-only instead of being forced through a busy animation frame.
      idleHandleRef.current = window.requestIdleCallback(start);
    } else {
      usesNativeIdleCallbackRef.current = false;
      // Safari has no requestIdleCallback. The timer is still cancelled on
      // every input/scroll/visibility transition before it can mount an img.
      idleHandleRef.current = window.setTimeout(start, 1_500);
    }

    return () => {
      cancelled = true;
      clearScheduledWork();
    };
  }, [activeSlug, canWarm, candidate, clearScheduledWork]);

  useEffect(() => {
    clearWarmupSafetyTimer();
    if (activeSlug === null || !canWarm) return;
    warmupSafetyTimerRef.current = window.setTimeout(advance, WARMUP_SAFETY_TIMEOUT_MS);
    return clearWarmupSafetyTimer;
  }, [activeSlug, advance, canWarm, clearWarmupSafetyTimer]);

  useEffect(
    () => () => {
      clearScheduledWork();
      clearWarmupSafetyTimer();
    },
    [clearScheduledWork, clearWarmupSafetyTimer],
  );

  const activeCandidate = canWarm ? queue.find((item) => item.slug === activeSlug) : null;
  if (!activeCandidate) return null;

  const { props } = getImageProps({
    src: activeCandidate.image,
    alt: "",
    width: activeCandidate.naturalWidth,
    height: activeCandidate.naturalHeight,
    sizes,
    loading: "eager",
    decoding: "async",
  });

  return (
    // getImageProps intentionally exposes the optimized CDN URL and srcset
    // used by next/image. A regular Image component cannot be cancelled
    // between queue entries without also creating its own loading state.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      alt=""
      aria-hidden="true"
      fetchPriority="low"
      className="pointer-events-none absolute h-px w-px opacity-0"
      onLoad={advance}
      onError={advance}
    />
  );
}
