"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { SortableList } from "@/components/admin/SortableList";
import { reorderBrands, deleteBrand } from "@/lib/admin/actions";
import { describeBrandUsage } from "@/lib/admin/queries";
import { cn } from "@/lib/utils";
import type { AdminBrand } from "@/lib/admin/queries";

export function BrandsList({ brands: initialBrands }: { brands: AdminBrand[] }) {
  const [brands, setBrands] = useState(initialBrands);
  const [, startTransition] = useTransition();

  function handleReorder(newBrands: AdminBrand[]) {
    setBrands(newBrands);
    startTransition(() => {
      reorderBrands(newBrands.map((brand) => brand.slug));
    });
  }

  function handleDelete(brand: AdminBrand) {
    if (!confirm(`Удалить бренд «${brand.name}»?${describeBrandUsage(brand)} Это действие необратимо.`)) return;

    setBrands((prev) => prev.filter((b) => b.slug !== brand.slug));
    startTransition(() => {
      deleteBrand(brand.slug);
    });
  }

  return (
    <SortableList
      className="mt-6"
      items={brands}
      getId={(brand) => brand.slug}
      onReorder={handleReorder}
      renderItem={(brand) => (
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40">
            {/* eslint-disable-next-line @next/next/no-img-element -- brand logos are SVGs, possibly hosted on Supabase Storage (external host) */}
            <img
              src={brand.logo}
              alt=""
              className="max-h-full max-w-full object-contain p-1"
              style={brand.logoScale ? { transform: `scale(${brand.logoScale})` } : undefined}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-card-foreground">{brand.name}</p>
            <p className="text-xs text-muted-foreground">{brand.country}</p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
              brand.relation === "from" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700"
            )}
          >
            {brand.relation === "from" ? "От бренда" : "Для бренда"}
          </span>
          {(brand.productCount > 0 || brand.categoryCount > 0) && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {brand.productCount} тов. / {brand.categoryCount} кат.
            </span>
          )}
          <Link href={`/admin/brands/${brand.slug}/edit`} className="shrink-0 text-sm text-primary hover:underline">
            Редактировать
          </Link>
          <button
            type="button"
            onClick={() => handleDelete(brand)}
            className="shrink-0 text-sm text-red-600 hover:underline"
          >
            Удалить
          </button>
        </div>
      )}
    />
  );
}
