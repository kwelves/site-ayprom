"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, ChevronDown } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { useHashNavClick } from "@/lib/use-hash-nav-click";
import type { VehicleType } from "@/types/catalog";

export function Hero({ vehicleTypes }: { vehicleTypes: VehicleType[] }) {
  const handleHashClick = useHashNavClick();
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  // The video can reach readyState >= 3 (autoplay starts) before React
  // hydrates and attaches onCanPlay, so that event fires on the bare DOM
  // node and never reaches our handler — check on mount as a fallback.
  useEffect(() => {
    if (!prefersReducedMotion && (videoRef.current?.readyState ?? 0) >= 3) setVideoLoaded(true);
  }, [prefersReducedMotion]);

  // The backdrop is fixed, but it does not need to keep decoding beneath the
  // rest of the page. Pause it as soon as Hero leaves the viewport so this
  // video and lower section backgrounds never compete for playback resources.
  useEffect(() => {
    const section = sectionRef.current;
    const video = videoRef.current;

    if (!section || !video || prefersReducedMotion) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          void video.play().catch(() => undefined);
        } else {
          video.pause();
        }
      },
      { threshold: 0.05 },
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, [prefersReducedMotion]);

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
          onLoadedData={() => setVideoLoaded(true)}
          // The hero intentionally has no static poster: it begins on the
          // first decoded frame of the streamed video. `loadeddata` fires
          // earlier than `canplay`, so a valid CDN stream becomes visible
          // without waiting for a larger playback buffer.
          className={`h-full w-full object-cover transition-opacity duration-1000 ${videoLoaded ? "opacity-100" : "opacity-0"}`}
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
      <Container className="pb-24 sm:pb-28 lg:pb-32">
        <div className="max-w-2xl">
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
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
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
