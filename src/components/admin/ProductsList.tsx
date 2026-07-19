"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { SortableList } from "@/components/admin/SortableList";
import { reorderProducts, deleteProduct } from "@/lib/admin/actions";
import { cn } from "@/lib/utils";
import type { AdminProductListItem } from "@/lib/admin/queries";

interface ProductsListProps {
  products: AdminProductListItem[];
  sortable?: boolean;
}

export function ProductsList({ products: initialProducts, sortable = true }: ProductsListProps) {
  const [products, setProducts] = useState(initialProducts);
  const [, startTransition] = useTransition();

  function handleReorder(newProducts: AdminProductListItem[]) {
    setProducts(newProducts);
    startTransition(() => {
      reorderProducts(newProducts.map((p) => p.slug));
    });
  }

  function handleDelete(slug: string, name: string) {
    if (!confirm(`Удалить товар «${name}»? Это действие необратимо.`)) return;
    setProducts((prev) => prev.filter((p) => p.slug !== slug));
    startTransition(() => {
      deleteProduct(slug);
    });
  }

  return (
    <SortableList
      className="mt-6"
      items={products}
      getId={(product) => product.slug}
      onReorder={handleReorder}
      disabled={!sortable}
      renderItem={(product) => (
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40">
            {product.coverImage && (
              // eslint-disable-next-line @next/next/no-img-element -- admin thumbnails can come from Supabase Storage (external host), simpler than configuring next/image remotePatterns for an internal tool
              <img src={product.coverImage} alt="" className="h-full w-full object-contain" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-card-foreground">{product.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{product.categoryName}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  product.published ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                )}
              >
                {product.published ? "Опубликован" : "Черновик"}
              </span>
              <Link
                href={`/admin/products/${product.slug}/edit`}
                className="rounded-md border border-border px-3 py-1 text-sm font-medium text-primary transition-colors hover:border-blue-200 hover:bg-accent"
              >
                Редактировать
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(product.slug, product.name)}
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
