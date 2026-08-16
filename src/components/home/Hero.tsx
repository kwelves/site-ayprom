"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, ChevronDown } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { useHashNavClick } from "@/lib/use-hash-nav-click";
import { useHomeEntrySequence } from "@/components/home/HomeEntrySequence";
import { DURATION } from "@/lib/motion";
import type { VehicleType } from "@/types/catalog";

const VIDEO_RECOVERY_DELAY_MS = 1_000;
const MAX_VIDEO_RECOVERY_ATTEMPTS = 1;

export function Hero({ vehicleTypes }: { vehicleTypes: VehicleType[] }) {
  const handleHashClick = useHashNavClick();
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recoveryTimerRef = useRef<number | null>(null);
  const recoveryAttemptsRef = useRef(0);
  const playbackAttemptRef = useRef<Promise<void> | null>(null);
  const playbackResyncAfterAttemptRef = useRef(false);
  const syncVideoPlaybackRef = useRef<() => void>(() => undefined);
  const heroIsVisibleRef = useRef(true);
  const pageIsHiddenRef = useRef(false);
  const videoFailedRef = useRef(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const { revealVideo, revealHeader, contentVisible } = useHomeEntrySequence();

  // `loadeddata` can fire before React hydrates and attaches its handler.
  // HAVE_CURRENT_DATA (2) is already a decoded current frame, which is the
  // exact readiness criterion for the boot overlay — do not wait for the
  // larger playback buffer at readyState 3 on a warm repeat visit.
  useEffect(() => {
    if ((videoRef.current?.readyState ?? 0) >= 2) setVideoLoaded(true);
  }, []);

  // The video is useful only while its section is on screen. Keep that state
  // in refs so every browser lifecycle event makes the same decision without
  // recreating observers or leaving a stale `videoFailed` closure behind.
  const isHeroPlaybackContextActive = useCallback(
    () => document.visibilityState === "visible" && heroIsVisibleRef.current && !pageIsHiddenRef.current,
    [],
  );

  const canPlayVideo = useCallback(
    () => isHeroPlaybackContextActive() && !videoFailedRef.current,
    [isHeroPlaybackContextActive],
  );

  const syncVideoPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!canPlayVideo()) {
      video.pause();
      return;
    }

    // `play()` is asynchronous. Do not stack calls while a source is loading:
    // repeated play/pause pairs are a common source of AbortError noise and a
    // visibly stalled first frame when returning to the tab.
    if (!video.paused) return;

    if (playbackAttemptRef.current !== null) {
      // `play()` can reject after a lifecycle pause. If the tab or BFCache
      // page returns before that promise settles, remember one contextual
      // retry so the visible video cannot remain paused behind a stale
      // in-flight attempt. The flag is consumed before the retry starts,
      // which prevents a rejected retry from looping indefinitely.
      playbackResyncAfterAttemptRef.current = true;
      return;
    }

    const playbackAttempt = video.play();
    playbackAttemptRef.current = playbackAttempt;
    void playbackAttempt.catch(() => undefined).finally(() => {
      if (playbackAttemptRef.current !== playbackAttempt) return;

      playbackAttemptRef.current = null;
      if (!playbackResyncAfterAttemptRef.current) return;

      playbackResyncAfterAttemptRef.current = false;
      // Use the latest callback rather than closing over this callback in
      // itself. The explicit one-time flag above avoids recursive retries.
      syncVideoPlaybackRef.current();
    });
  }, [canPlayVideo]);

  useEffect(() => {
    syncVideoPlaybackRef.current = syncVideoPlayback;
  }, [syncVideoPlayback]);

  const recoverVideo = useCallback(() => {
    if (recoveryAttemptsRef.current >= MAX_VIDEO_RECOVERY_ATTEMPTS) return;
    const video = videoRef.current;
    if (!video || !isHeroPlaybackContextActive()) return;

    recoveryAttemptsRef.current += 1;
    videoFailedRef.current = false;
    video.load();
  }, [isHeroPlaybackContextActive]);

  const handleVideoError = useCallback(() => {
    setVideoLoaded(false);
    videoFailedRef.current = true;
    // A missing stream must never keep navigation or the page inaccessible.
    // There is intentionally no poster: the inverse base remains in place
    // while one bounded, low-pressure recovery attempt is made.
    revealHeader();

    if (recoveryAttemptsRef.current >= MAX_VIDEO_RECOVERY_ATTEMPTS || recoveryTimerRef.current !== null) return;
    recoveryTimerRef.current = window.setTimeout(() => {
      recoveryTimerRef.current = null;
      recoverVideo();
    }, prefersReducedMotion ? 0 : VIDEO_RECOVERY_DELAY_MS);
  }, [prefersReducedMotion, recoverVideo, revealHeader]);

  // Clear only on unmount. Lifecycle listeners are stable, so an error-driven
  // retry remains scheduled until it runs or a recovered `loadeddata` cancels
  // it.
  useEffect(
    () => () => {
      if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
    },
    [],
  );

  // A real decoded frame, not merely the request start, opens the first-view
  // sequence. Let its short opacity transition finish under the opaque boot
  // layer, then fade the layer and only then reveal the header. That keeps the
  // intended visual order: video → header → content.
  useEffect(() => {
    if (!videoLoaded) return;
    if (prefersReducedMotion) {
      revealVideo();
      revealHeader();
      return;
    }

    let videoTimer: number | undefined;
    let headerTimer: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      videoTimer = window.setTimeout(() => {
        revealVideo();
        headerTimer = window.setTimeout(revealHeader, DURATION.base * 1000);
      }, DURATION.fast * 1000);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (videoTimer !== undefined) window.clearTimeout(videoTimer);
      if (headerTimer !== undefined) window.clearTimeout(headerTimer);
    };
  }, [prefersReducedMotion, revealHeader, revealVideo, videoLoaded]);

  // The backdrop is fixed, but it does not need to keep decoding beneath the
  // rest of the page. A single gate handles document visibility, BFCache
  // restoration, and Hero intersection so the video resumes promptly only
  // when a person can see it.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const recoverOrSyncPlayback = () => {
      if (isHeroPlaybackContextActive() && videoFailedRef.current) {
        recoverVideo();
      } else {
        syncVideoPlayback();
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        heroIsVisibleRef.current = entry.isIntersecting;
        recoverOrSyncPlayback();
      },
      // A frame must keep playing until the Hero is actually gone. This
      // prevents a briefly visible final strip of video from looking frozen.
      { threshold: 0 },
    );

    const pauseForPageHide = () => {
      pageIsHiddenRef.current = true;
      videoRef.current?.pause();
    };

    const resumeAfterPageShow = () => {
      pageIsHiddenRef.current = false;
      recoverOrSyncPlayback();
    };

    observer.observe(section);
    document.addEventListener("visibilitychange", recoverOrSyncPlayback);
    window.addEventListener("pageshow", resumeAfterPageShow);
    window.addEventListener("pagehide", pauseForPageHide);
    syncVideoPlayback();

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", recoverOrSyncPlayback);
      window.removeEventListener("pageshow", resumeAfterPageShow);
      window.removeEventListener("pagehide", pauseForPageHide);
    };
  }, [isHeroPlaybackContextActive, recoverVideo, syncVideoPlayback]);

  // Not a plain scrollIntoView({block: "start"}) — that aligns the next
  // section's top edge with the very top of the viewport, but the sticky
  // Header (h-16 = 64px) then sits on top of that edge and overlaps into
  // the section, eating its top spacing. Offsetting by the header's height
  // keeps the header's bottom edge flush with the section's top instead.
  const scrollToNextSection = (event?: React.MouseEvent) => {
    event?.preventDefault();
    const target = sectionRef.current?.nextElementSibling;
    if (!target) return;
    const top = target.getBoundingClientRect().top + window.scrollY - 64;
    window.scrollTo({ top, behavior: prefersReducedMotion ? "auto" : "smooth" });
  };

  return (
    <section ref={sectionRef} className="relative flex min-h-[calc(100dvh-4rem)] items-end">
      {/* Fixed backdrop: the video stays pinned to the viewport while the page scrolls over it */}
      <div className="fixed inset-x-0 top-0 -z-10 h-dvh bg-inverse">
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          onLoadedData={() => {
            // A recovered stream can decode before its scheduled retry runs.
            // Cancel that retry so `load()` cannot restart a healthy playback.
            if (recoveryTimerRef.current !== null) {
              window.clearTimeout(recoveryTimerRef.current);
              recoveryTimerRef.current = null;
            }
            videoFailedRef.current = false;
            recoveryAttemptsRef.current = 0;
            setVideoLoaded(true);
            syncVideoPlayback();
          }}
          // There is intentionally no static poster. If the CDN stream fails,
          // do not leave navigation and content inaccessible behind a blank
          // video layer; the site can still be used while the browser retries.
          onError={handleVideoError}
          // The hero intentionally has no static poster: it begins on the
          // first decoded frame of the streamed video. `loadeddata` fires
          // earlier than `canplay`, so a valid CDN stream becomes visible
          // without waiting for a larger playback buffer.
          className={`h-full w-full object-cover transition-opacity duration-fast ${videoLoaded ? "opacity-100" : "opacity-0"}`}
        >
          <source
            src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/site-media/hero/2026-08-16-hq/hero-background-mobile.mp4`}
            type="video/mp4"
            media="(max-width: 767px)"
          />
          <source
            src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/site-media/hero/2026-08-16-hq/hero-background-desktop.mp4`}
            type="video/mp4"
            media="(min-width: 2560px)"
          />
          <source
            src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/site-media/hero/2026-08-16-balanced/hero-background-desktop.mp4`}
            type="video/mp4"
          />
        </video>
        {/* Directional gradient instead of a flat overlay: the top of the video
            stays bright (sky, the truck itself), darkening only toward the
            bottom where the text sits — guarantees contrast there regardless
            of what's in that part of the frame, without dimming the whole shot. */}
        <div className="absolute inset-0 bg-gradient-to-t from-inverse/90 via-inverse/35 to-transparent" />
        {/* This gradient fades to nothing right at the top, so the transparent
            Header's white logo/nav text — sitting directly on the video up
            there — has no guaranteed contrast of its own. A second, short
            top-anchored gradient covers just that strip without touching how
            bright the rest of the video reads. */}
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-inverse/55 to-transparent sm:h-28" />
      </div>

      {/* Появление первого экрана — CSS-анимация, а не варианты framer-motion.
          Заголовок здесь почти наверняка LCP-элемент, а у Framer он стартует
          с opacity: 0 и становится виден только после гидратации: сначала
          загрузка и исполнение JS, и лишь потом появление. Класс же работает
          с первого отрисованного кадра. Задержки заменяют каскад вариантов,
          `prefers-reduced-motion` глушится общим правилом в globals.css. */}
      <Container
        aria-hidden={!contentVisible}
        className={`pb-24 transition-[opacity,translate] duration-reveal ease-ui sm:pb-28 lg:pb-32 ${contentVisible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}
      >
        <div inert={!contentVisible} className="max-w-2xl">
          <h1 className="animate-fade-up text-shadow-md text-balance text-3xl font-bold tracking-tight text-inverse-foreground sm:text-4xl lg:text-5xl">
            Каталог гидрооборудования и запчастей для спецтехники
          </h1>
          {vehicleTypes.length > 0 && (
            <div
              className="mt-6 flex animate-fade-up flex-wrap items-center gap-2 text-shadow-sm text-xl font-medium text-inverse-foreground-muted [animation-delay:60ms]"
            >
              {vehicleTypes.map((vehicleType, i) => (
                <span key={vehicleType.slug} className="flex items-center gap-2">
                  {i > 0 && <span className="text-inverse-foreground-subtle">/</span>}
                  <Link
                    href={`/catalog/vehicle-type/${vehicleType.slug}`}
                    className="transition-colors hover:text-primary"
                  >
                    {vehicleType.name}
                  </Link>
                </span>
              ))}
            </div>
          )}

          <form
            action="/catalog"
            method="GET"
            className="mt-12 flex w-full max-w-lg animate-fade-up items-center gap-2 rounded-lg border border-input bg-card p-1.5 shadow-sm [animation-delay:120ms] focus-within:border-ring focus-within:ring-1 focus-within:ring-ring"
          >
            <Search aria-hidden="true" className="ml-2 h-5 w-5 shrink-0 text-faint-foreground" />
            <input
              type="text"
              name="q"
              aria-label="Поиск по каталогу"
              autoComplete="off"
              placeholder="Например: гидроцилиндр HOWO…"
              className="h-10 w-full border-0 bg-transparent text-base text-foreground outline-none placeholder:text-faint-foreground"
            />
            <Button type="submit" size="lg" className="shrink-0">
              Найти
            </Button>
          </form>

          {/* flex-nowrap + shrinking padding/text (not flex-wrap) — on narrow
              phones these two buttons should stay side by side and shrink
              together rather than the second one dropping to its own line. */}
          <div className="mt-6 flex animate-fade-up flex-nowrap gap-2 [animation-delay:180ms] sm:gap-3">
            <Button
              href="/#categories"
              size="lg"
              className="min-w-0 flex-1 px-3 text-sm whitespace-nowrap sm:flex-initial sm:px-6 sm:text-base"
              onClick={(event) => handleHashClick("/#categories", event)}
            >
              Перейти в каталог
            </Button>
            <Button
              href="/#brands"
              variant="secondary"
              size="lg"
              className="min-w-0 flex-1 px-3 text-sm whitespace-nowrap sm:flex-initial sm:px-6 sm:text-base"
              onClick={(event) => handleHashClick("/#brands", event)}
            >
              Марки техники
            </Button>
          </div>
        </div>
      </Container>

      {/* Покачивание — CSS-ключевые кадры, а не бесконечный animate у Framer:
          тот держал rAF-цикл на главном потоке всё время, пока открыта
          главная, в том числе когда первый экран уже прокручен. Обёртка нужна,
          чтобы центрирование (`-translate-x-1/2`) и анимация не спорили за
          свойство `translate`. */}
      <div
        aria-hidden={!contentVisible}
        inert={!contentVisible}
        className={`absolute bottom-4 left-1/2 -translate-x-1/2 transition-[opacity,translate] duration-reveal ease-ui ${contentVisible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}
      >
        <button
          type="button"
          onClick={scrollToNextSection}
          aria-label="Прокрутить вниз"
          className="animate-nudge-down rounded-full p-2.5 text-inverse-foreground/80 transition-colors duration-fast ease-ui hover:text-inverse-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inverse-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-inverse"
        >
          <ChevronDown aria-hidden="true" className="h-8 w-8" />
        </button>
      </div>
    </section>
  );
}
