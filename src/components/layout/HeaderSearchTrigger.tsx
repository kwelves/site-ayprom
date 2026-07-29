"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeaderSearchTriggerProps {
  overPhoto: boolean;
  logoRef: RefObject<HTMLElement | null>;
  onOpen?: () => void;
}

const DEFAULT_WIDTH = 224;
const MIN_WIDTH = 120;
const MAX_WIDTH = 280;
const LOGO_GAP = 24;

// Icon stays put and becomes the submit button; the input grows out of it
// leftward via an absolutely-positioned element so it never affects header
// layout (see docs/design-orchestration for the redesign rationale). Width
// is measured against the logo's actual right edge, not guessed from
// viewport breakpoints, so it never overlaps the logo on narrow screens.
export function HeaderSearchTrigger({ overPhoto, logoRef, onOpen }: HeaderSearchTriggerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    function updateWidth() {
      const container = containerRef.current;
      const logo = logoRef.current;
      if (!container || !logo) return;
      const available = container.getBoundingClientRect().right - logo.getBoundingClientRect().right - LOGO_GAP;
      setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, available)));
    }
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [logoRef]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function submit() {
    const trimmed = query.trim();
    setOpen(false);
    if (trimmed) router.push(`/catalog?q=${encodeURIComponent(trimmed)}`);
  }

  function handleIconClick() {
    if (open) {
      submit();
    } else {
      onOpen?.();
      setOpen(true);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative flex h-9 items-center">
      <AnimatePresence initial={false}>
        {open && (
          <motion.input
            ref={inputRef}
            type="text"
            aria-label="Поиск по каталогу"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: "easeOut" }}
            className="absolute inset-y-0 right-0 rounded-full border border-slate-300 bg-card py-1.5 pr-10 pl-3 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
          />
        )}
      </AnimatePresence>
      <button
        type="button"
        onClick={handleIconClick}
        aria-label={open ? "Выполнить поиск" : "Открыть поиск"}
        aria-expanded={open}
        className={cn(
          "relative z-10 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
          open
            ? "bg-primary text-primary-foreground hover:bg-blue-700"
            : overPhoto
              ? "text-white hover:bg-white/10"
              : "text-slate-700 hover:bg-accent",
        )}
      >
        <Search className="h-5 w-5" />
      </button>
    </div>
  );
}
