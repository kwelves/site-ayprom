"use client";

import { useState, useRef } from "react";
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
}

export function NavDropdown({ label, href, items, light }: NavDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const twoColumn = items.length > 4;
  const handleHashClick = useHashNavClick();

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
            <div
              className={cn(
                "grid gap-1 rounded-xl border border-border bg-card p-2 shadow-lg shadow-foreground/5",
                twoColumn && "grid-cols-2"
              )}
            >
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group flex items-start gap-3 rounded-lg p-2.5 transition-colors hover:bg-accent/60"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="flex flex-col">
                      <span className="text-sm font-semibold text-card-foreground">{item.label}</span>
                      <span className="text-xs text-muted-foreground">{item.description}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
