"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useHashNavClick } from "@/lib/use-hash-nav-click";
import { DURATION, EASE_UI } from "@/lib/motion";
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
  /** Caps the item list to a fixed height and makes it scroll internally
   * instead of growing the panel. */
  scrollable?: boolean;
}

export function NavDropdown({ label, href, items, light, fixedSingleColumn, scrollable }: NavDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const suppressNextFocusOpenRef = useRef(false);
  const panelId = useId();
  const twoColumn = !fixedSingleColumn && items.length > 4;
  const handleHashClick = useHashNavClick();

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => {
        if (!suppressNextFocusOpenRef.current) setOpen(true);
      }}
      onBlur={(event) => {
        if (!containerRef.current?.contains(event.relatedTarget as Node)) {
          setOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        suppressNextFocusOpenRef.current = true;
        setOpen(false);
        triggerRef.current?.focus();
        queueMicrotask(() => {
          suppressNextFocusOpenRef.current = false;
        });
      }}
    >
      <Link
        ref={triggerRef}
        href={href}
        onClick={(event) => handleHashClick(href, event)}
        className={cn(
          "flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-fast ease-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          light
            ? "text-inverse-foreground hover:bg-inverse-foreground/10"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          open && (light ? "bg-inverse-foreground/10" : "bg-accent text-accent-foreground")
        )}
        aria-expanded={open}
        aria-controls={panelId}
      >
        {label}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-base ease-ui", open && "rotate-180")} />
      </Link>

      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE_UI } }}
            exit={{ opacity: 0, y: 4, transition: { duration: DURATION.fast, ease: EASE_UI } }}
            className={cn(
              "absolute left-1/2 top-full z-50 -translate-x-1/2 pt-2",
              twoColumn ? "w-[34rem]" : "w-80"
            )}
          >
            <div className="rounded-xl border border-border bg-card p-2 shadow-lg shadow-foreground/5">
              <div
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
                  scrollable && "max-h-64 overflow-y-auto overscroll-contain"
                )}
              >
                {items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group flex items-start gap-3 rounded-lg p-2.5 transition-colors duration-fast ease-ui hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    {item.logo ? (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card">
                        {/* eslint-disable-next-line @next/next/no-img-element -- local brand SVGs; next/image blocks them without dangerouslyAllowSVG */}
                        <img
                          src={item.logo}
                          alt=""
                          className="h-full w-full object-contain p-1"
                        />
                      </span>
                    ) : null}
                    <span className="flex flex-col">
                      <span className="text-sm font-semibold text-card-foreground">{item.label}</span>
                      {item.description && <span className="text-xs text-muted-foreground">{item.description}</span>}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
