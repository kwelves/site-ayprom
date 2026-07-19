"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { SortableList } from "@/components/admin/SortableList";
import { reorderBrands, deleteBrand } from "@/lib/admin/actions";
import { describeBrandUsage } from "@/lib/admin/queries";
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
        <div className="flex items-start gap-3">
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
            <p className="text-sm font-medium text-card-foreground">{brand.name}</p>
            {(brand.productCount > 0 || brand.categoryCount > 0) && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {brand.productCount} тов. / {brand.categoryCount} кат.
              </p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">{brand.country}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Link
                href={`/admin/brands/${brand.slug}/edit`}
                className="rounded-md border border-border px-3 py-1 text-sm font-medium text-primary transition-colors hover:border-blue-200 hover:bg-accent"
              >
                Редактировать
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(brand)}
                className="rounded-md border border-red-200 px-3 py-1 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    />
  );
}
