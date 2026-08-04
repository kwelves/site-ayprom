"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useHashNavClick } from "@/lib/use-hash-nav-click";
import { cn } from "@/lib/utils";
import type { NavDropdownItem } from "@/lib/navigation";

interface NavDropdownProps {
  label: string;
  href: string;
  items: NavDropdownItem[];
  /** Light trigger colors for use over the dark hero photo. */
  light?: boolean;
  /** Pins the panel to a single, fixed-width column regardless of item
   * count — for lists that can keep growing (e.g. every brand in the
   * catalog) so the panel's footprint never balloons into two columns. */
  fixedSingleColumn?: boolean;
  /** Caps the item list to a fixed height and makes it scroll internally,
   * with its own scroll-position indicator, instead of growing the panel. */
  scrollable?: boolean;
}

export function NavDropdown({ label, href, items, light, fixedSingleColumn, scrollable }: NavDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const twoColumn = !fixedSingleColumn && items.length > 4;
  const handleHashClick = useHashNavClick();

  // Thumb size/offset as fractions of the track (0–1). Tracked independently
  // of the page's own scroll position (useScroll in Header) — this list has
  // its own scrollTop and never reads or writes window scroll state.
  const [thumb, setThumb] = useState({ size: 1, offset: 0 });

  const measureScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const size = clientHeight >= scrollHeight ? 1 : clientHeight / scrollHeight;
    const maxScroll = scrollHeight - clientHeight;
    const offset = maxScroll > 0 ? scrollTop / maxScroll : 0;
    setThumb({ size, offset });
  }, []);

  useEffect(() => {
    if (open && scrollable) {
      // Measure after the panel has actually mounted/expanded, not just on
      // scroll — otherwise the indicator stays invisible until first scroll.
      const id = requestAnimationFrame(measureScroll);
      return () => cancelAnimationFrame(id);
    }
  }, [open, scrollable, measureScroll]);

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!containerRef.current?.contains(event.relatedTarget as Node)) {
          setOpen(false);
        }
      }}
    >
      <Link
        href={href}
        onClick={(event) => handleHashClick(href, event)}
        className={cn(
          "flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          light
            ? "text-white hover:bg-white/10"
            : "text-slate-700 hover:bg-accent hover:text-accent-foreground",
          open && (light ? "bg-white/10" : "bg-accent text-accent-foreground")
        )}
        aria-expanded={open}
      >
        {label}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-180")} />
      </Link>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className={cn(
              "absolute left-1/2 top-full z-50 -translate-x-1/2 pt-2",
              twoColumn ? "w-[34rem]" : "w-80"
            )}
          >
            <div className="relative rounded-xl border border-border bg-card p-2 shadow-lg shadow-foreground/5">
              <div
                ref={listRef}
                onScroll={scrollable ? measureScroll : undefined}
                // Isolation: hovering/scrolling this list must never leak into
                // page-level state (Header's window-scroll listener, any
                // future mouse-tracking effects) and vice versa — the list
                // keeps its own scrollTop, unrelated to window scroll.
                onWheel={(event) => event.stopPropagation()}
                onMouseMove={(event) => event.stopPropagation()}
                className={cn(
                  "grid gap-1",
                  twoColumn && "grid-cols-2",
                  // overscroll-contain stops this list from chaining its
                  // scroll into the page once it hits the top/bottom edge.
                  scrollable && "no-scrollbar max-h-64 overflow-y-auto overscroll-contain pr-3"
                )}
              >
                {items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group flex items-start gap-3 rounded-lg p-2.5 transition-colors hover:bg-accent/60"
                  >
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg",
                        item.logo
                          ? "border border-border bg-white"
                          : "bg-accent text-accent-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
                      )}
                    >
                      {item.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element -- local brand SVGs; next/image blocks them without dangerouslyAllowSVG
                        <img
                          src={item.logo}
                          alt=""
                          className="h-full w-full object-contain p-1"
                        />
                      ) : item.icon ? (
                        <item.icon className="h-4 w-4" />
                      ) : null}
                    </span>
                    <span className="flex flex-col">
                      <span className="text-sm font-semibold text-card-foreground">{item.label}</span>
                      <span className="text-xs text-muted-foreground">{item.description}</span>
                    </span>
                  </Link>
                ))}
              </div>

              {scrollable && thumb.size < 1 && (
                <div className="pointer-events-none absolute bottom-2 right-1.5 top-2 w-1 rounded-full bg-border">
                  <div
                    className="absolute left-0 w-full rounded-full bg-slate-400"
                    style={{
                      height: `${thumb.size * 100}%`,
                      top: `${thumb.offset * (1 - thumb.size) * 100}%`,
                    }}
                  />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
