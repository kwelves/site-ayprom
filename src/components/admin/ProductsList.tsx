"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { SortableList } from "@/components/admin/SortableList";
import { Toast } from "@/components/admin/ui/Toast";
import { reorderProducts, deleteProduct, toggleProductPublished } from "@/lib/admin/actions";
import { useAdminList } from "@/lib/admin/use-admin-list";
import { cn } from "@/lib/utils";
import type { AdminProductListItem } from "@/lib/admin/queries";

interface ProductsListProps {
  products: AdminProductListItem[];
  sortable?: boolean;
  flashSlug?: string;
  flashAction?: "created" | "updated";
}

export function ProductsList({ products: initialProducts, sortable = true, flashSlug, flashAction }: ProductsListProps) {
  const { items: products, setItems: setProducts, startTransition, handleReorder, removeItem, toast, dismissToast, highlightedKey } =
    useAdminList<AdminProductListItem>({
      initial: initialProducts,
      getId: (p) => p.slug,
      reorder: reorderProducts,
      remove: deleteProduct,
      messages: { created: "Товар успешно добавлен", updated: "Товар успешно отредактирован" },
      flashSlug,
      flashAction,
    });

  function handleDelete(product: AdminProductListItem) {
    if (!confirm(`Удалить товар «${product.name}»? Это действие необратимо.`)) return;
    removeItem(product);
  }

  // Publish toggle is products-only, so it stays here rather than in the shared
  // hook — an optimistic in-place update (not a remove) built on the hook's
  // exposed setItems / startTransition.
  function handleTogglePublished(slug: string, nextPublished: boolean) {
    setProducts((prev) => prev.map((p) => (p.slug === slug ? { ...p, published: nextPublished } : p)));
    startTransition(() => {
      toggleProductPublished(slug, nextPublished);
    });
  }

  return (
    <>
      <SortableList
        className="mt-6"
        items={products}
        getId={(product) => product.slug}
        onReorder={handleReorder}
        disabled={!sortable}
        highlightedKey={highlightedKey}
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
              <button
                type="button"
                onClick={() => handleTogglePublished(product.slug, !product.published)}
                aria-pressed={product.published}
                aria-label={`Переключить публикацию товара «${product.name}»`}
                className={cn(
                  "overflow-hidden rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
                  product.published
                    ? "bg-green-100 text-green-700 hover:bg-green-200"
                    : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                )}
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={product.published ? "published" : "draft"}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="block"
                  >
                    {product.published ? "Опубликован" : "Черновик"}
                  </motion.span>
                </AnimatePresence>
              </button>
              <Link
                href={`/admin/products/${product.slug}/edit`}
                className="rounded-md border border-border px-3 py-1 text-sm font-medium text-primary transition-colors hover:border-blue-200 hover:bg-accent"
              >
                Редактировать
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(product)}
                className="rounded-md border border-red-200 px-3 py-1 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
        )}
      />
      <Toast message={toast} onDismiss={dismissToast} />
    </>
  );
}
