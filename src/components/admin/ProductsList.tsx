"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SortableList } from "@/components/admin/SortableList";
import { Toast } from "@/components/admin/ui/Toast";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import { Checkbox } from "@/components/admin/ui/Checkbox";
import { SegmentedControl } from "@/components/admin/ui/SegmentedControl";
import { BulkActionBar } from "@/components/admin/ui/BulkActionBar";
import { QuickViewPanel } from "@/components/admin/ui/QuickViewPanel";
import {
  reorderProducts,
  deleteProduct,
  toggleProductPublished,
  toggleProductAvailability,
  bulkUpdateProducts,
} from "@/lib/admin/actions";
import { useAdminList } from "@/lib/admin/use-admin-list";
import { useConfirmDelete } from "@/lib/admin/use-confirm-delete";
import { DURATION, EASE_UI } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  PRODUCT_AVAILABILITY_LABELS,
  PRODUCT_AVAILABILITY_OPTIONS,
  type ProductAvailability,
} from "@/lib/admin/product-availability";
import type { AdminProductListItem } from "@/lib/admin/queries";

interface ProductsListProps {
  products: AdminProductListItem[];
  reorderDisabled?: boolean;
  flashSlug?: string;
  flashAction?: "created" | "updated";
}

const AVAILABILITY_TONE: Record<ProductAvailability, string> = {
  in_stock: "bg-success-surface text-success",
  out_of_stock: "bg-danger-surface text-danger",
  unclear: "bg-warning-surface text-warning",
};

const AVAILABILITY_OPTIONS = PRODUCT_AVAILABILITY_OPTIONS.map((value) => ({
  value,
  label: PRODUCT_AVAILABILITY_LABELS[value],
  activeClassName: AVAILABILITY_TONE[value],
}));

// Триггер пишет updated_at в UTC — то же преобразование в местное время, что
// и в журнале изменений.
const UPDATED_DATE_FORMAT = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeZone: "Asia/Bishkek" });

function bulkCountLabel(count: number): string {
  return `Выбрано: ${count}`;
}

// Перетаскивание доступно всегда — в том числе при активном поиске, фильтре и
// на любой странице списка. Раньше его приходилось отключать на подмножествах,
// потому что сортировка нумеровала товары подряд от нуля и ломала позиции всех
// остальных. reorder_products переставляет товары внутри уже занятых ими
// значений order, поэтому выборка перестраивается, не задевая каталог.
// Единственное исключение — сортировка "по названию"/"по дате" (reorderDisabled):
// в этом режиме видимый порядок и order расходятся, поэтому drag-n-drop
// временно выключен, а не вводит в заблуждение.
export function ProductsList({ products: initialProducts, reorderDisabled, flashSlug, flashAction }: ProductsListProps) {
  const [unpublishProduct, setUnpublishProduct] = useState<AdminProductListItem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkUnpublishConfirmOpen, setBulkUnpublishConfirmOpen] = useState(false);
  const [quickViewProduct, setQuickViewProduct] = useState<AdminProductListItem | null>(null);
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

  const deleteConfirm = useConfirmDelete<AdminProductListItem>(removeItem);

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

  function handleTogglePublished(product: AdminProductListItem, nextPublished: boolean) {
    if (product.published && !nextPublished && product.hotspotCount > 0) {
      setUnpublishProduct(product);
      return;
    }
    applyPublishedToggle(product, nextPublished);
  }

  function closeUnpublishDialog() {
    setUnpublishProduct(null);
  }

  function confirmUnpublish() {
    if (!unpublishProduct) return;
    applyPublishedToggle(unpublishProduct, false, true);
    setUnpublishProduct(null);
  }

  function handleAvailabilityChange(product: AdminProductListItem, next: ProductAvailability) {
    const previous = products;
    setProducts((prev) => prev.map((p) => (p.slug === product.slug ? { ...p, availability: next } : p)));
    dismissActionError();
    startTransition(async () => {
      try {
        await toggleProductAvailability(product.slug, next);
      } catch {
        setProducts(previous);
        reportActionError("Не удалось изменить наличие. Статус товара возвращён в прежнее состояние.");
      }
    });
  }

  function toggleSelected(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function applyBulkPatch(patch: { published?: boolean; availability?: ProductAvailability }) {
    const slugs = [...selected];
    const previous = products;
    setProducts((prev) => prev.map((p) => (slugs.includes(p.slug) ? { ...p, ...patch } : p)));
    dismissActionError();
    clearSelection();
    startTransition(async () => {
      try {
        await bulkUpdateProducts(slugs, patch);
      } catch {
        setProducts(previous);
        reportActionError("Не удалось применить массовое действие. Список возвращён в прежнее состояние.");
      }
    });
  }

  function handleBulkUnpublishClick() {
    const affectsHotspots = products.some((p) => selected.has(p.slug) && p.published && p.hotspotCount > 0);
    if (affectsHotspots) {
      setBulkUnpublishConfirmOpen(true);
      return;
    }
    applyBulkPatch({ published: false });
  }

  return (
    <>
      <SortableList
        className="mt-6"
        items={products}
        getId={(product) => product.slug}
        onReorder={handleReorder}
        disabled={reorderDisabled}
        enableStepButtons
        highlightedKey={highlightedKey}
        renderItem={(product) => (
        <div className="flex items-start gap-3">
          <Checkbox
            label=""
            aria-label={`Выделить товар «${product.name}»`}
            checked={selected.has(product.slug)}
            onChange={() => toggleSelected(product.slug)}
            className="mt-1"
          />
          <button
            type="button"
            onClick={() => setQuickViewProduct(product)}
            aria-label={`Быстрый просмотр товара «${product.name}»`}
            className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40"
          >
            {product.coverImage && (
              <Image src={product.coverImage} alt="" width={48} height={48} className="h-full w-full object-contain" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <button type="button" onClick={() => setQuickViewProduct(product)} className="text-left">
              <p className="text-sm font-medium text-card-foreground hover:underline">{product.name}</p>
            </button>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {product.categoryName}
              {product.article && ` · Арт. ${product.article}`}
              {" · изменено "}
              {UPDATED_DATE_FORMAT.format(new Date(product.updatedAt))}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => handleTogglePublished(product, !product.published)}
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
              <SegmentedControl
                aria-label={`Наличие товара «${product.name}»`}
                options={AVAILABILITY_OPTIONS}
                value={product.availability}
                onChange={(next) => handleAvailabilityChange(product, next)}
              />
              <Link
                href={`/admin/products/${product.slug}/edit`}
                className="rounded-md border border-border px-3 py-1 text-sm font-medium text-primary transition-colors hover:border-border-interactive hover:bg-accent"
              >
                Редактировать
              </Link>
              <button
                type="button"
                onClick={() => deleteConfirm.request(product)}
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
      <ConfirmDialog
        open={unpublishProduct !== null}
        title="Снять товар с публикации?"
        description={
          unpublishProduct ? (
            <>
              Товар «{unpublishProduct.name}» будет отвязан от {unpublishProduct.hotspotCount}{" "}
              {unpublishProduct.hotspotCount === 1 ? "хотспота" : "хотспотов"} в разделе «Спецтехника». На сайте вместо него
              появится заглушка.
            </>
          ) : null
        }
        cancelLabel="Отмена"
        confirmLabel="Снять с публикации"
        tone="danger"
        onCancel={closeUnpublishDialog}
        onConfirm={confirmUnpublish}
      />
      <ConfirmDialog
        open={bulkUnpublishConfirmOpen}
        title="Снять выбранные товары с публикации?"
        description="Среди выделенных есть товары, привязанные к хотспотам в разделе «Спецтехника» — они будут отвязаны."
        cancelLabel="Отмена"
        confirmLabel="Снять с публикации"
        tone="danger"
        onCancel={() => setBulkUnpublishConfirmOpen(false)}
        onConfirm={() => {
          setBulkUnpublishConfirmOpen(false);
          applyBulkPatch({ published: false });
        }}
      />
      <ConfirmDialog
        open={deleteConfirm.pending !== null}
        title={`Удалить товар «${deleteConfirm.pending?.name}»?`}
        description="Это действие необратимо."
        cancelLabel="Отмена"
        confirmLabel="Удалить"
        tone="danger"
        onCancel={deleteConfirm.cancel}
        onConfirm={deleteConfirm.confirm}
      />
      <QuickViewPanel
        open={quickViewProduct !== null}
        title={quickViewProduct?.name ?? ""}
        onClose={() => setQuickViewProduct(null)}
        footer={
          quickViewProduct && (
            <Link
              href={`/admin/products/${quickViewProduct.slug}/edit`}
              className="block w-full rounded-md bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              Редактировать товар
            </Link>
          )
        }
      >
        {quickViewProduct && (
          <div className="space-y-4">
            <div className="flex h-40 w-full items-center justify-center overflow-hidden rounded-md bg-muted/40">
              {quickViewProduct.coverImage && (
                <Image
                  src={quickViewProduct.coverImage}
                  alt=""
                  width={200}
                  height={160}
                  className="h-full w-full object-contain"
                />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium",
                  quickViewProduct.published ? "bg-success-surface text-success" : "bg-warning-surface text-warning",
                )}
              >
                {quickViewProduct.published ? "Опубликован" : "Черновик"}
              </span>
              <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", AVAILABILITY_TONE[quickViewProduct.availability])}>
                {PRODUCT_AVAILABILITY_LABELS[quickViewProduct.availability]}
              </span>
            </div>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Категория</dt>
                <dd className="text-card-foreground">{quickViewProduct.categoryName}</dd>
              </div>
              {quickViewProduct.article && (
                <div>
                  <dt className="text-xs text-muted-foreground">Артикул</dt>
                  <dd className="text-card-foreground">{quickViewProduct.article}</dd>
                </div>
              )}
              {quickViewProduct.shortDescription && (
                <div>
                  <dt className="text-xs text-muted-foreground">Краткое описание</dt>
                  <dd className="text-card-foreground">{quickViewProduct.shortDescription}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted-foreground">Изменено</dt>
                <dd className="text-card-foreground">{UPDATED_DATE_FORMAT.format(new Date(quickViewProduct.updatedAt))}</dd>
              </div>
            </dl>
          </div>
        )}
      </QuickViewPanel>
      <BulkActionBar count={selected.size} itemLabel={bulkCountLabel} onClear={clearSelection}>
        <button
          type="button"
          onClick={() => applyBulkPatch({ published: true })}
          className="rounded-full bg-success-surface px-3 py-1.5 text-xs font-medium text-success transition-colors hover:bg-success-surface-hover"
        >
          Опубликовать
        </button>
        <button
          type="button"
          onClick={handleBulkUnpublishClick}
          className="rounded-full bg-warning-surface px-3 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning-surface-hover"
        >
          Снять с публикации
        </button>
        {AVAILABILITY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => applyBulkPatch({ availability: option.value })}
            className={cn("rounded-full px-3 py-1.5 text-xs font-medium transition-colors", option.activeClassName)}
          >
            {option.label}
          </button>
        ))}
      </BulkActionBar>
    </>
  );
}
