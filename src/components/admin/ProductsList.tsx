"use client";

import Link from "next/link";
import { useCallback, useState, useTransition } from "react";
import { SortableList } from "@/components/admin/SortableList";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import { Checkbox } from "@/components/admin/ui/Checkbox";
import { SegmentedControl } from "@/components/admin/ui/SegmentedControl";
import { BulkActionBar } from "@/components/admin/ui/BulkActionBar";
import { QuickViewPanel } from "@/components/admin/ui/QuickViewPanel";
import { ImageFallback } from "@/components/ui/ImageFallback";
import { Pencil, Trash2 } from "lucide-react";
import { ProductThumb } from "@/components/admin/ProductThumb";
import { buttonClassName } from "@/components/admin/ui/button-styles";
import { AdminUndoToast } from "@/components/admin/ui/AdminUndoToast";
import { ProductActionsButton, ProductActionsPanel } from "@/components/admin/ProductActionsPanel";
import { applyOptimisticProductPatch } from "@/components/admin/product-publication-state";
import {
  reorderProducts,
  deleteProduct,
  toggleProductPublished,
  toggleProductAvailability,
  bulkUpdateProducts,
  updateProductHotspotAssignments,
} from "@/lib/admin/actions";
import { useAdminList } from "@/lib/admin/use-admin-list";
import { useConfirmDelete } from "@/lib/admin/use-confirm-delete";
import { cn } from "@/lib/utils";
import {
  PRODUCT_AVAILABILITY_LABELS,
  PRODUCT_AVAILABILITY_OPTIONS,
  type ProductAvailability,
} from "@/lib/admin/product-availability";
import type { AdminProductHotspotOption, AdminProductListItem } from "@/lib/admin/queries";
import type { ProductHotspotAssignmentUpdate } from "@/lib/admin/product-hotspot-assignments";

interface ProductsListProps {
  products: AdminProductListItem[];
  hotspotOptions: AdminProductHotspotOption[];
  reorderDisabled?: boolean;
  flashSlug?: string;
  flashAction?: "created" | "updated";
  flashWarning?: string;
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
interface HotspotUndoState {
  id: number;
  message: string;
  reverseUpdates: ProductHotspotAssignmentUpdate[];
  restorePatch: HotspotUiPatch;
}

interface HotspotUiPatch {
  products: Array<Pick<AdminProductListItem, "id" | "hotspotCount">>;
  hotspotOptions: Array<Pick<AdminProductHotspotOption, "id" | "product">>;
}

function captureHotspotUiPatch(
  products: AdminProductListItem[],
  hotspotOptions: AdminProductHotspotOption[],
  productIds: Array<string | null>,
  hotspotIds: Array<string | null>,
): HotspotUiPatch {
  const productIdSet = new Set(productIds.filter((id): id is string => id !== null));
  const hotspotIdSet = new Set(hotspotIds.filter((id): id is string => id !== null));
  return {
    products: products
      .filter((product) => productIdSet.has(product.id))
      .map(({ id, hotspotCount }) => ({ id, hotspotCount })),
    hotspotOptions: hotspotOptions
      .filter((hotspot) => hotspotIdSet.has(hotspot.id))
      .map(({ id, product }) => ({ id, product })),
  };
}

function applyProductHotspotPatch(products: AdminProductListItem[], patch: HotspotUiPatch): AdminProductListItem[] {
  const byId = new Map(patch.products.map((product) => [product.id, product]));
  return products.map((product) => {
    const saved = byId.get(product.id);
    return saved ? { ...product, hotspotCount: saved.hotspotCount } : product;
  });
}

function applyHotspotOptionsPatch(
  hotspotOptions: AdminProductHotspotOption[],
  patch: HotspotUiPatch,
): AdminProductHotspotOption[] {
  const byId = new Map(patch.hotspotOptions.map((hotspot) => [hotspot.id, hotspot]));
  return hotspotOptions.map((hotspot) => {
    const saved = byId.get(hotspot.id);
    return saved ? { ...hotspot, product: saved.product } : hotspot;
  });
}

export function ProductsList({
  products: initialProducts,
  hotspotOptions: initialHotspotOptions,
  reorderDisabled,
  flashSlug,
  flashAction,
  flashWarning,
}: ProductsListProps) {
  const [unpublishProduct, setUnpublishProduct] = useState<AdminProductListItem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkUnpublishConfirmOpen, setBulkUnpublishConfirmOpen] = useState(false);
  const [quickViewProduct, setQuickViewProduct] = useState<AdminProductListItem | null>(null);
  const [actionsProductId, setActionsProductId] = useState<string | null>(null);
  const [hotspotOptions, setHotspotOptions] = useState(initialHotspotOptions);
  const [serverHotspotOptions, setServerHotspotOptions] = useState(initialHotspotOptions);
  const [hotspotUndo, setHotspotUndo] = useState<HotspotUndoState | null>(null);
  const [isHotspotPending, startHotspotTransition] = useTransition();
  const {
    items: products,
    setItems: setProducts,
    startTransition,
    handleReorder,
    removeItem,
    highlightedKey,
    actionError,
    dismissActionError,
    reportActionError,
    reportSuccess,
  } =
    useAdminList<AdminProductListItem>({
      initial: initialProducts,
      getId: (p) => p.slug,
      reorder: reorderProducts,
      remove: (slug) => deleteProduct(slug, false),
      messages: {
        created: "Товар успешно добавлен",
        updated: "Товар успешно отредактирован",
        deleted: "Товар успешно удалён",
        reordered: "Порядок товаров сохранён",
      },
      flashSlug,
      flashAction,
      flashWarning,
    });

  const deleteConfirm = useConfirmDelete<AdminProductListItem>(removeItem);
  const actionsProduct = products.find((product) => product.id === actionsProductId) ?? null;
  const dismissHotspotUndo = useCallback(() => setHotspotUndo(null), []);

  // Keep the showcase assignment cache on the same incoming server snapshot as
  // the product rows after edits, unpublishing, or deletion.
  if (initialHotspotOptions !== serverHotspotOptions) {
    setServerHotspotOptions(initialHotspotOptions);
    setHotspotOptions(initialHotspotOptions);
  }

  function runHotspotMutation(
    updates: ProductHotspotAssignmentUpdate[],
    nextProducts: AdminProductListItem[],
    nextHotspotOptions: AdminProductHotspotOption[],
    undo: Omit<HotspotUndoState, "id">,
  ) {
    setProducts(nextProducts);
    setHotspotOptions(nextHotspotOptions);
    dismissActionError();
    setHotspotUndo(null);

    startHotspotTransition(async () => {
      let result;
      try {
        result = await updateProductHotspotAssignments(updates);
      } catch {
        setProducts((current) => applyProductHotspotPatch(current, undo.restorePatch));
        setHotspotOptions((current) => applyHotspotOptionsPatch(current, undo.restorePatch));
        reportActionError("Не удалось изменить хотспот. Проверьте подключение и попробуйте снова.");
        return;
      }
      if (!result || "error" in result) {
        setProducts((current) => applyProductHotspotPatch(current, undo.restorePatch));
        setHotspotOptions((current) => applyHotspotOptionsPatch(current, undo.restorePatch));
        reportActionError(
          result?.error ?? "Не удалось изменить хотспот. Данные могли измениться. Обновите страницу и попробуйте снова.",
        );
        return;
      }
      setActionsProductId(null);
      setHotspotUndo({ ...undo, id: Date.now() });
    });
  }

  function assignProductToHotspot(product: AdminProductListItem, target: AdminProductHotspotOption) {
    if (target.product?.id === product.id) return;

    const displacedProductId = target.product?.id ?? null;
    const restorePatch = captureHotspotUiPatch(products, hotspotOptions, [product.id, displacedProductId], [target.id]);
    const updates: ProductHotspotAssignmentUpdate[] = [
      { hotspotId: target.id, expectedProductId: displacedProductId, productId: product.id },
    ];

    const nextProducts = products.map((item) => {
      if (item.id === product.id) {
        return { ...item, hotspotCount: item.hotspotCount + 1 };
      }
      if (item.id === displacedProductId) {
        return { ...item, hotspotCount: Math.max(0, item.hotspotCount - 1) };
      }
      return item;
    });
    const nextHotspotOptions = hotspotOptions.map((hotspot) => {
      if (hotspot.id === target.id) {
        return { ...hotspot, product: { id: product.id, slug: product.slug, name: product.name } };
      }
      return hotspot;
    });
    runHotspotMutation(updates, nextProducts, nextHotspotOptions, {
      message: product.hotspotCount > 0 ? "Товар закреплён ещё за одним хотспотом" : "Товар закреплён за хотспотом",
      reverseUpdates: [{ hotspotId: target.id, expectedProductId: product.id, productId: displacedProductId }],
      restorePatch,
    });
  }

  function detachProductFromHotspot(product: AdminProductListItem, hotspot: AdminProductHotspotOption) {
    if (hotspot.product?.id !== product.id) return;
    const restorePatch = captureHotspotUiPatch(products, hotspotOptions, [product.id], [hotspot.id]);
    const nextProducts = products.map((item) =>
      item.id === product.id ? { ...item, hotspotCount: Math.max(0, item.hotspotCount - 1) } : item,
    );
    const nextHotspotOptions = hotspotOptions.map((item) =>
      item.id === hotspot.id ? { ...item, product: null } : item,
    );
    runHotspotMutation(
      [{ hotspotId: hotspot.id, expectedProductId: product.id, productId: null }],
      nextProducts,
      nextHotspotOptions,
      {
        message: "Товар снят с хотспота",
        reverseUpdates: [{ hotspotId: hotspot.id, expectedProductId: null, productId: product.id }],
        restorePatch,
      },
    );
  }

  function undoHotspotMutation() {
    if (!hotspotUndo) return;
    const undo = hotspotUndo;
    const rollbackPatch = captureHotspotUiPatch(
      products,
      hotspotOptions,
      undo.restorePatch.products.map((product) => product.id),
      undo.restorePatch.hotspotOptions.map((hotspot) => hotspot.id),
    );
    setProducts((current) => applyProductHotspotPatch(current, undo.restorePatch));
    setHotspotOptions((current) => applyHotspotOptionsPatch(current, undo.restorePatch));
    dismissActionError();

    startHotspotTransition(async () => {
      let result;
      try {
        result = await updateProductHotspotAssignments(undo.reverseUpdates);
      } catch {
        setProducts((current) => applyProductHotspotPatch(current, rollbackPatch));
        setHotspotOptions((current) => applyHotspotOptionsPatch(current, rollbackPatch));
        reportActionError("Не удалось отменить действие. Проверьте подключение и попробуйте снова.");
        return;
      }
      if (!result || "error" in result) {
        setProducts((current) => applyProductHotspotPatch(current, rollbackPatch));
        setHotspotOptions((current) => applyHotspotOptionsPatch(current, rollbackPatch));
        reportActionError(
          result?.error ?? "Не удалось отменить действие. Данные могли измениться. Обновите страницу.",
        );
        return;
      }
      setHotspotUndo(null);
    });
  }

  // Publish toggle is products-only, so it stays here rather than in the shared
  // hook — an optimistic in-place update (not a remove) built on the hook's
  // exposed setItems / startTransition.
  function applyPublishedToggle(product: AdminProductListItem, nextPublished: boolean, confirmedUnpublish = false) {
    const previousProducts = products;
    const previousHotspotOptions = hotspotOptions;
    const optimistic = applyOptimisticProductPatch(products, hotspotOptions, [product.slug], {
      published: nextPublished,
    });
    setProducts(optimistic.products);
    setHotspotOptions(optimistic.hotspotOptions);
    dismissActionError();
    startTransition(async () => {
      try {
        await toggleProductPublished(product.slug, nextPublished, confirmedUnpublish);
        reportSuccess(nextPublished ? "Товар опубликован" : "Товар снят с публикации");
      } catch (error) {
        setProducts(previousProducts);
        setHotspotOptions(previousHotspotOptions);
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
        reportSuccess("Наличие товара обновлено");
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
    const previousProducts = products;
    const previousHotspotOptions = hotspotOptions;
    const optimistic = applyOptimisticProductPatch(products, hotspotOptions, slugs, patch);
    setProducts(optimistic.products);
    setHotspotOptions(optimistic.hotspotOptions);
    dismissActionError();
    clearSelection();
    startTransition(async () => {
      try {
        await bulkUpdateProducts(slugs, patch);
        reportSuccess(`Обновлено товаров: ${slugs.length}`);
      } catch {
        setProducts(previousProducts);
        setHotspotOptions(previousHotspotOptions);
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
        <div className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 xl:flex">
          <Checkbox
            label=""
            aria-label={`Выделить товар «${product.name}»`}
            checked={selected.has(product.slug)}
            onChange={() => toggleSelected(product.slug)}
            containerClassName="min-h-11 justify-center xl:min-h-0"
            className="size-5 xl:size-4"
          />
          <ProductThumb product={product} onOpen={() => setQuickViewProduct(product)} />
          <div className="min-w-0 xl:flex-1">
            <button type="button" onClick={() => setQuickViewProduct(product)} className="block min-w-0 max-w-full text-left">
              <p className="break-words text-sm font-semibold leading-snug text-foreground [overflow-wrap:anywhere] decoration-primary/40 underline-offset-4 hover:underline">
                {product.name}
              </p>
            </button>
            <p className="mt-1 truncate text-xs leading-snug text-muted-foreground">
              {product.categoryName}
              {product.article && (
                <>
                  {" · Арт. "}
                  <span className="tabular-nums slashed-zero">{product.article}</span>
                </>
              )}
              {" · изменено "}
              <span className="tabular-nums">{UPDATED_DATE_FORMAT.format(new Date(product.updatedAt))}</span>
            </p>
          </div>
          <div className="xl:order-last">
            <ProductActionsButton product={product} onOpen={() => setActionsProductId(product.id)} />
          </div>
          <div className="col-span-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 min-[420px]:flex min-[420px]:flex-wrap xl:flex-nowrap xl:gap-2.5">
            <button
              type="button"
              onClick={() => handleTogglePublished(product, !product.published)}
              aria-pressed={product.published}
              aria-label={`Переключить публикацию товара «${product.name}»`}
              title={product.published ? "Снять с публикации" : "Опубликовать"}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 justify-self-start overflow-hidden rounded-full px-3 text-xs font-semibold transition-[background-color,color,scale] duration-fast ease-ui active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30 xl:h-7 xl:min-h-0",
                product.published
                  ? "bg-success-surface text-success hover:bg-success-surface-hover"
                  : "bg-warning-surface text-warning hover:bg-warning-surface-hover"
              )}
            >
              <span aria-hidden="true" className={cn("size-1.5 rounded-full transition-colors duration-fast", product.published ? "bg-success" : "bg-warning")} />
              <span className="grid" aria-hidden="true">
                <span
                  className={cn(
                    "col-start-1 row-start-1 transition-[opacity,translate] duration-fast ease-ui",
                    product.published ? "translate-y-0 opacity-100" : "-translate-y-1.5 opacity-0"
                  )}
                >
                  Опубликован
                </span>
                <span
                  className={cn(
                    "col-start-1 row-start-1 transition-[opacity,translate] duration-fast ease-ui",
                    product.published ? "translate-y-1.5 opacity-0" : "translate-y-0 opacity-100"
                  )}
                >
                  Черновик
                </span>
              </span>
            </button>
            <SegmentedControl
              aria-label={`Наличие товара «${product.name}»`}
              options={AVAILABILITY_OPTIONS}
              value={product.availability}
              onChange={(next) => handleAvailabilityChange(product, next)}
              className="col-span-3 row-start-2 w-full min-[420px]:w-auto"
            />
            <Link
              href={`/admin/products/${product.slug}/edit`}
              className={buttonClassName({ variant: "glass", size: "sm", className: "min-h-11 xl:ml-auto xl:min-h-0" })}
            >
              <Pencil aria-hidden="true" className="!size-4" />
              <span className="xl:hidden">Изменить</span>
              <span className="hidden xl:inline">Редактировать</span>
            </Link>
            <button
              type="button"
              onClick={() => deleteConfirm.request(product)}
              className={buttonClassName({ variant: "ghost", size: "sm", className: "min-h-11 text-danger hover:bg-danger-surface hover:text-danger xl:min-h-0" })}
            >
              <Trash2 aria-hidden="true" className="!size-4" />
              <span className="max-sm:sr-only">Удалить</span>
            </button>
          </div>
        </div>
        )}
      />
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
            <div className="relative flex h-40 w-full items-center justify-center overflow-hidden rounded-md bg-muted/40">
              {quickViewProduct.coverImage && (
                <ImageFallback
                  src={quickViewProduct.coverImage}
                  fallbackSrc={quickViewProduct.coverImageFallback ?? undefined}
                  alt={quickViewProduct.name}
                  sizes="200px"
                  unoptimized
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
      {actionsProduct && (
        <ProductActionsPanel
          key={actionsProduct.id}
          open
          product={actionsProduct}
          hotspots={hotspotOptions}
          pending={isHotspotPending}
          onClose={() => {
            if (!isHotspotPending) setActionsProductId(null);
          }}
          onAssign={(hotspot) => assignProductToHotspot(actionsProduct, hotspot)}
          onDetach={(hotspot) => detachProductFromHotspot(actionsProduct, hotspot)}
        />
      )}
      <AdminUndoToast
        toast={hotspotUndo ? { id: hotspotUndo.id, message: hotspotUndo.message } : null}
        actionLabel="Отменить"
        pending={isHotspotPending}
        onAction={undoHotspotMutation}
        onDismiss={dismissHotspotUndo}
      />
      <BulkActionBar
        count={selected.size}
        itemLabel={bulkCountLabel}
        onClear={clearSelection}
        groups={[
          {
            label: "Публикация",
            mobileClassName: "grid-cols-2",
            actions: (
              <>
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
              </>
            ),
          },
          {
            label: "Наличие",
            mobileClassName: "grid-cols-3",
            actions: AVAILABILITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => applyBulkPatch({ availability: option.value })}
                className={cn("rounded-full px-3 py-1.5 text-xs font-medium transition-colors", option.activeClassName)}
              >
                {option.label}
              </button>
            )),
          },
        ]}
      />
    </>
  );
}
