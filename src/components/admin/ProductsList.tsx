"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SortableList } from "@/components/admin/SortableList";
import { Toast } from "@/components/admin/ui/Toast";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import { reorderProducts, deleteProduct, toggleProductPublished } from "@/lib/admin/actions";
import { useAdminList } from "@/lib/admin/use-admin-list";
import { DURATION, EASE_UI } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { AdminProductListItem } from "@/lib/admin/queries";

interface ProductsListProps {
  products: AdminProductListItem[];
  flashSlug?: string;
  flashAction?: "created" | "updated";
}

// Перетаскивание доступно всегда — в том числе при активном поиске, фильтре и
// на любой странице списка. Раньше его приходилось отключать на подмножествах,
// потому что сортировка нумеровала товары подряд от нуля и ломала позиции всех
// остальных. reorder_products переставляет товары внутри уже занятых ими
// значений order, поэтому выборка перестраивается, не задевая каталог.
export function ProductsList({ products: initialProducts, flashSlug, flashAction }: ProductsListProps) {
  const [unpublishProduct, setUnpublishProduct] = useState<AdminProductListItem | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const toggleTriggerRef = useRef<HTMLElement | null>(null);
  const {
    items: products,
    setItems: setProducts,
    startTransition,
    handleReorder,
    removeItem,
    toast,
    dismissToast,
    highlightedKey,
    actionError,
    dismissActionError,
    reportActionError,
  } =
    useAdminList<AdminProductListItem>({
      initial: initialProducts,
      getId: (p) => p.slug,
      reorder: reorderProducts,
      remove: deleteProduct,
      messages: { created: "Товар успешно добавлен", updated: "Товар успешно отредактирован" },
      flashSlug,
      flashAction,
    });

  useEffect(() => {
    if (unpublishProduct) cancelButtonRef.current?.focus();
  }, [unpublishProduct]);

  function handleDelete(product: AdminProductListItem) {
    if (!confirm(`Удалить товар «${product.name}»? Это действие необратимо.`)) return;
    removeItem(product);
  }

  // Publish toggle is products-only, so it stays here rather than in the shared
  // hook — an optimistic in-place update (not a remove) built on the hook's
  // exposed setItems / startTransition.
  function applyPublishedToggle(product: AdminProductListItem, nextPublished: boolean, confirmedUnpublish = false) {
    const previous = products;
    setProducts((prev) => prev.map((p) => (p.slug === product.slug ? { ...p, published: nextPublished } : p)));
    dismissActionError();
    startTransition(async () => {
      try {
        await toggleProductPublished(product.slug, nextPublished, confirmedUnpublish);
      } catch (error) {
        setProducts(previous);
        reportActionError(
          error instanceof Error
            ? error.message
            : "Не удалось изменить публикацию. Статус товара возвращён в прежнее состояние."
        );
      }
    });
  }

  function handleTogglePublished(product: AdminProductListItem, nextPublished: boolean, trigger: HTMLElement) {
    if (product.published && !nextPublished && product.hotspotCount > 0) {
      toggleTriggerRef.current = trigger;
      setUnpublishProduct(product);
      return;
    }
    applyPublishedToggle(product, nextPublished);
  }

  function closeUnpublishDialog() {
    setUnpublishProduct(null);
    requestAnimationFrame(() => toggleTriggerRef.current?.focus());
  }

  function confirmUnpublish() {
    if (!unpublishProduct) return;
    applyPublishedToggle(unpublishProduct, false, true);
    setUnpublishProduct(null);
  }

  function handleUnpublishDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeUnpublishDialog();
      return;
    }
    if (event.key !== "Tab") return;

    const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
    if (!buttons || buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <SortableList
        className="mt-6"
        items={products}
        getId={(product) => product.slug}
        onReorder={handleReorder}
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
                onClick={(event) => handleTogglePublished(product, !product.published, event.currentTarget)}
                aria-pressed={product.published}
                aria-label={`Переключить публикацию товара «${product.name}»`}
                className={cn(
                  "overflow-hidden rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
                  product.published
                    ? "bg-success-surface text-success hover:bg-success-surface-hover"
                    : "bg-warning-surface text-warning hover:bg-warning-surface-hover"
                )}
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={product.published ? "published" : "draft"}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: DURATION.fast, ease: EASE_UI } }}
                    exit={{ opacity: 0, y: -6, transition: { duration: DURATION.fast, ease: EASE_UI } }}
                    className="block"
                  >
                    {product.published ? "Опубликован" : "Черновик"}
                  </motion.span>
                </AnimatePresence>
              </button>
              <Link
                href={`/admin/products/${product.slug}/edit`}
                className="rounded-md border border-border px-3 py-1 text-sm font-medium text-primary transition-colors hover:border-border-interactive hover:bg-accent"
              >
                Редактировать
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(product)}
                className="rounded-md border border-danger-border px-3 py-1 text-sm font-medium text-danger transition-colors hover:bg-danger-surface"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
        )}
      />
      <Toast message={toast} onDismiss={dismissToast} />
      <AdminActionFeedback
        message={actionError}
        onDismiss={dismissActionError}
      />
      {unpublishProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="unpublish-product-title"
            aria-describedby="unpublish-product-description"
            onKeyDown={handleUnpublishDialogKeyDown}
            className="w-full max-w-md rounded-lg border border-warning-border bg-card p-5 shadow-lg"
          >
            <h2 id="unpublish-product-title" className="text-base font-semibold text-card-foreground">
              Снять товар с публикации?
            </h2>
            <p id="unpublish-product-description" className="mt-2 text-sm text-muted-foreground">
              Товар «{unpublishProduct.name}» будет отвязан от {unpublishProduct.hotspotCount} {unpublishProduct.hotspotCount === 1 ? "хотспота" : "хотспотов"} в разделе «Спецтехника». На сайте вместо него появится заглушка.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={closeUnpublishDialog}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-card-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={confirmUnpublish}
                className="rounded-md border border-danger-border bg-danger-surface px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
              >
                Снять с публикации
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
