"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, ChevronDown } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { fadeUp, staggerContainer } from "@/lib/motion";
import { useHashNavClick } from "@/lib/use-hash-nav-click";
import type { Category, VehicleType } from "@/types/catalog";

export function Hero({
  vehicleTypes,
  categories,
}: {
  vehicleTypes: VehicleType[];
  categories: Category[];
}) {
  const handleHashClick = useHashNavClick();
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
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
      <div className="fixed inset-x-0 top-0 -z-10 h-dvh bg-slate-900">
        {/* Keep the poster independent from the video element. If the media
            request fails, the video never reaches canplay and remains
            transparent, while this fallback still fills the Hero. */}
        <div
          aria-hidden="true"
          className={`absolute inset-0 bg-cover bg-center transition-opacity duration-700 ${
            videoLoaded && !videoFailed ? "opacity-0" : "opacity-100"
          }`}
          style={{ backgroundImage: "url('/images/under-hero-photo.webp')" }}
        />
        {!prefersReducedMotion && (
          <video
            ref={videoRef}
            poster="/images/under-hero-photo.webp"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            onCanPlay={() => setVideoLoaded(true)}
            onError={() => {
              setVideoFailed(true);
              setVideoLoaded(false);
            }}
            className={`relative h-full w-full object-cover transition-opacity duration-1000 ${
              videoLoaded && !videoFailed ? "opacity-100" : "opacity-0"
            }`}
          >
            <source
              src="/videos/hero-background-mobile.mp4"
              type="video/mp4"
              media="(max-width: 767px)"
            />
            <source src="/videos/hero-background-desktop.mp4" type="video/mp4" />
          </video>
        )}
        {/* Directional gradient instead of a flat overlay: the top of the video
            stays bright (sky, the truck itself), darkening only toward the
            bottom where the text sits — guarantees contrast there regardless
            of what's in that part of the frame, without dimming the whole shot. */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/35 to-transparent" />
        {/* Soft local falloff behind the title. It belongs to the video backdrop,
            so the Hero content itself remains transparent and visually floating. */}
        <div className="absolute left-0 top-[16%] h-[52%] w-[88%] bg-[radial-gradient(ellipse_at_22%_50%,rgba(2,6,23,0.44)_0%,rgba(2,6,23,0.25)_38%,rgba(2,6,23,0.09)_63%,transparent_82%)] sm:top-[17%] sm:h-[50%] sm:w-[74%] lg:top-[18%] lg:h-[48%] lg:w-[62%]" />
        {/* A long, diffused fade gives the transparent Header consistent contrast
            without leaving a visible dark band across the video. */}
        <div className="absolute inset-x-0 top-0 h-32 bg-[linear-gradient(180deg,rgba(2,6,23,0.62)_0%,rgba(2,6,23,0.32)_42%,rgba(2,6,23,0.11)_70%,transparent_100%)] sm:h-36" />
      </div>

      <Container className="pb-24 sm:pb-28 lg:pb-32">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="max-w-2xl"
        >
          <motion.h1
            variants={fadeUp}
            className="text-shadow-md text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl"
          >
            Каталог гидрооборудования и запчастей для спецтехники
          </motion.h1>
          {vehicleTypes.length > 0 && (
            <motion.div
              variants={fadeUp}
              className="mt-6 flex flex-wrap items-center gap-2 text-shadow-sm text-xl font-medium text-slate-200"
            >
              {vehicleTypes.map((vehicleType, i) => (
                <span key={vehicleType.slug} className="flex items-center gap-2">
                  {i > 0 && <span className="text-slate-400">/</span>}
                  <Link
                    href={`/catalog/vehicle-type/${vehicleType.slug}`}
                    className="transition-colors hover:text-primary"
                  >
                    {vehicleType.name}
                  </Link>
                </span>
              ))}
            </motion.div>
          )}

          <motion.form
            variants={fadeUp}
            action="/catalog"
            method="GET"
            className="mt-12 flex w-full max-w-lg items-center gap-2 rounded-lg border border-slate-300 bg-card p-1.5 shadow-sm focus-within:border-ring focus-within:ring-1 focus-within:ring-ring"
          >
            <Search aria-hidden="true" className="ml-2 h-5 w-5 shrink-0 text-slate-400" />
            <input
              type="text"
              name="q"
              aria-label="Поиск по каталогу"
              autoComplete="off"
              placeholder="Например: гидроцилиндр HOWO…"
              className="h-10 w-full border-0 bg-transparent text-base text-foreground outline-none placeholder:text-slate-400"
            />
            <Button type="submit" size="lg" className="shrink-0">
              Найти
            </Button>
          </motion.form>

          {/* flex-nowrap + shrinking padding/text (not flex-wrap) — on narrow
              phones these two buttons should stay side by side and shrink
              together rather than the second one dropping to its own line. */}
          <motion.div variants={fadeUp} className="mt-6 flex flex-nowrap gap-2 sm:gap-3">
            <Button
              href="/#categories"
              size="lg"
              className="min-w-0 flex-1 px-3 text-sm whitespace-nowrap sm:flex-initial sm:px-6 sm:text-base"
              onClick={scrollToNextSection}
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
          </motion.div>

          {categories.length > 0 && (
            <motion.div variants={fadeUp} className="mt-4 flex flex-wrap gap-2">
              {categories.slice(0, 6).map((category) => (
                <Link
                  key={category.slug}
                  href={`/catalog/category/${category.slug}`}
                  className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:border-white/40 hover:bg-white/20 sm:text-sm"
                >
                  {category.name}
                </Link>
              ))}
            </motion.div>
          )}
        </motion.div>
      </Container>

      <motion.button
        type="button"
        onClick={scrollToNextSection}
        aria-label="Прокрутить вниз"
        className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full p-2.5 text-white/80 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
        animate={prefersReducedMotion ? undefined : { y: [0, 8, 0] }}
        transition={prefersReducedMotion ? undefined : { duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      >
        <ChevronDown aria-hidden="true" className="h-8 w-8" />
      </motion.button>
    </section>
  );
}
