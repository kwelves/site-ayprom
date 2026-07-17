"use client";

import { useRef } from "react";
import Link from "next/link";
import { Search, ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { fadeUp, staggerContainer } from "@/lib/motion";
import { useHashNavClick } from "@/lib/use-hash-nav-click";

// Placeholder navigation — links into the regular catalog search rather than
// a real "vehicle type" filter, since that's a whole new catalog dimension
// (new Product field, new pages, tagging every product) not built yet.
const vehicleTypeLinks = [
  { label: "Самосвал", href: "/catalog?q=самосвал" },
  { label: "Кран-Манипулятор", href: "/catalog?q=кран-манипулятор" },
  { label: "Тягач", href: "/catalog?q=тягач" },
];

export function Hero() {
  const handleHashClick = useHashNavClick();
  const sectionRef = useRef<HTMLElement>(null);

  const scrollToNextSection = () => {
    sectionRef.current?.nextElementSibling?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section ref={sectionRef} className="relative flex min-h-[calc(100dvh-4rem)] items-center">
      {/* Fixed backdrop: the photo stays pinned to the viewport while the page scrolls over it */}
      <div className="fixed inset-x-0 top-0 -z-10 h-dvh">
        <video
          src="/videos/hero-background.mp4"
          autoPlay
          muted
          loop
          playsInline
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-slate-900/55" />
      </div>

      <Container className="py-14 sm:py-20 lg:py-24">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="max-w-2xl"
        >
          <motion.h1
            variants={fadeUp}
            className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl"
          >
            Каталог гидрооборудования и запчастей
            <br />
            для спецтехники
          </motion.h1>
          <motion.div
            variants={fadeUp}
            className="mt-6 flex flex-wrap items-center gap-2 text-lg text-slate-200"
          >
            {vehicleTypeLinks.map((item, i) => (
              <span key={item.label} className="flex items-center gap-2">
                {i > 0 && <span className="text-slate-400">/</span>}
                <Link href={item.href} className="transition-colors hover:text-primary">
                  {item.label}
                </Link>
              </span>
            ))}
          </motion.div>

          <motion.form
            variants={fadeUp}
            action="/catalog"
            method="GET"
            className="mt-12 flex w-full max-w-lg items-center gap-2 rounded-lg border border-slate-300 bg-card p-1.5 shadow-sm focus-within:border-ring focus-within:ring-1 focus-within:ring-ring"
          >
            <Search className="ml-2 h-5 w-5 shrink-0 text-slate-400" />
            <input
              type="text"
              name="q"
              placeholder="Например: гидроцилиндр HOWO"
              className="h-10 w-full border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-slate-400"
            />
            <Button type="submit" className="shrink-0">
              Найти
            </Button>
          </motion.form>

          <motion.div variants={fadeUp} className="mt-6 flex flex-wrap gap-3">
            <Button href="/catalog" size="lg">
              Перейти в каталог
            </Button>
            <Button
              href="/#brands"
              variant="secondary"
              size="lg"
              onClick={(event) => handleHashClick("/#brands", event)}
            >
              Марки техники
            </Button>
          </motion.div>
        </motion.div>
      </Container>

      <motion.button
        type="button"
        onClick={scrollToNextSection}
        aria-label="Прокрутить вниз"
        className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/80 transition-colors hover:text-white"
        animate={{ y: [0, 8, 0] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      >
        <ChevronDown className="h-8 w-8" />
      </motion.button>
    </section>
  );
}
