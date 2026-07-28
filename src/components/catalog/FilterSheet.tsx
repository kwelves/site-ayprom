"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { SlidersHorizontal } from "lucide-react";
import { FilterChipGroup } from "@/components/catalog/FilterChipGroup";
import { catalogHref, hasActiveFacets, type CatalogFilterParams } from "@/lib/catalog-filters";
import { cn } from "@/lib/utils";

interface FacetGroup {
  label: string;
  chips: { slug: string; name: string; active: boolean; href: string }[];
}

interface FilterSheetProps {
  current: CatalogFilterParams;
  groups: FacetGroup[];
  className?: string;
}

// Mobile bottom-sheet trigger, mirroring the height/opacity collapse used by
// Header's mobile menu (src/components/layout/Header.tsx) so open/close
// motion feels consistent site-wide.
export function FilterSheet({ current, groups, className }: FilterSheetProps) {
  const [open, setOpen] = useState(false);
  const activeCount = [current.category, current.brand, current.vehicleType].filter(Boolean).length;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="catalog-filter-sheet"
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground"
      >
        <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
        Фильтры
        {activeCount > 0 && (
          <span className="rounded-full bg-primary px-1.5 py-0.5 text-xs font-mono text-primary-foreground">
            {activeCount}
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="catalog-filter-sheet"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-5 rounded-lg border border-border bg-card p-4">
              {hasActiveFacets(current) && (
                <Link
                  href={catalogHref(current, { category: undefined, brand: undefined, vehicleType: undefined })}
                  className={cn("text-sm font-medium text-primary hover:underline")}
                >
                  Сбросить фильтры
                </Link>
              )}
              {groups.map((group) => (
                <FilterChipGroup key={group.label} label={group.label} chips={group.chips} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
