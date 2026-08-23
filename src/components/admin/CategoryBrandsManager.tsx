"use client";

import { useState, useTransition } from "react";
import { SortableList } from "@/components/admin/SortableList";
import { Input } from "@/components/admin/ui/Input";
import { Select } from "@/components/admin/ui/Select";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  addCategoryBrand,
  removeCategoryBrand,
  updateCategoryBrandOverride,
  reorderCategoryBrands,
} from "@/lib/admin/actions";
import { useConfirmDelete } from "@/lib/admin/use-confirm-delete";
import { useAdminToast } from "@/components/admin/ui/AdminToastProvider";
import type { AdminBrand, AdminCategoryBrand } from "@/lib/admin/queries";

interface CategoryBrandsManagerProps {
  categorySlug: string;
  initialAttached: AdminCategoryBrand[];
  allBrands: AdminBrand[];
}

export function CategoryBrandsManager({ categorySlug, initialAttached, allBrands }: CategoryBrandsManagerProps) {
  const [attached, setAttached] = useState(initialAttached);
  const [selectedBrandToAdd, setSelectedBrandToAdd] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { success } = useAdminToast();

  const attachedSlugs = new Set(attached.map((brand) => brand.brandSlug));
  const available = allBrands.filter((brand) => !attachedSlugs.has(brand.slug));

  function handleReorder(newAttached: AdminCategoryBrand[]) {
    const previous = attached;
    setAttached(newAttached);
    setActionError(null);
    startTransition(async () => {
      try {
        await reorderCategoryBrands(categorySlug, newAttached.map((brand) => brand.brandSlug));
        success("Порядок брендов категории сохранён");
      } catch {
        setAttached(previous);
        setActionError("Не удалось сохранить порядок брендов. Список возвращён в прежнее состояние.");
      }
    });
  }

  const removeConfirm = useConfirmDelete<AdminCategoryBrand>((brand) => {
    const previous = attached;
    setAttached((prev) => prev.filter((b) => b.brandSlug !== brand.brandSlug));
    setActionError(null);
    startTransition(async () => {
      try {
        await removeCategoryBrand(categorySlug, brand.brandSlug);
        success("Бренд убран из категории");
      } catch {
        setAttached(previous);
        setActionError("Не удалось убрать бренд. Связь восстановлена.");
      }
    });
  });

  function handleOverrideBlur(brandSlug: string, rawValue: string) {
    const parsed = rawValue.trim() ? Number(rawValue) : null;
    const value = parsed !== null && Number.isFinite(parsed) ? parsed : null;
    const previous = attached;
    setAttached((prev) =>
      prev.map((b) => (b.brandSlug === brandSlug ? { ...b, logoScaleOverride: value ?? undefined } : b))
    );
    setActionError(null);
    startTransition(async () => {
      try {
        await updateCategoryBrandOverride(categorySlug, brandSlug, value);
        success("Масштаб логотипа сохранён");
      } catch {
        setAttached(previous);
        setActionError("Не удалось сохранить масштаб логотипа. Значение восстановлено.");
      }
    });
  }

  function handleAdd() {
    const brand = allBrands.find((b) => b.slug === selectedBrandToAdd);
    if (!brand) return;

    const previous = attached;
    setAttached((prev) => [
      ...prev,
      {
        brandSlug: brand.slug,
        brandName: brand.name,
        brandLogo: brand.logo,
        logoScaleOverride: undefined,
        order: prev.length,
      },
    ]);
    setSelectedBrandToAdd("");
    setActionError(null);
    startTransition(async () => {
      try {
        await addCategoryBrand(categorySlug, brand.slug);
        success("Бренд добавлен в категорию");
      } catch {
        setAttached(previous);
        setSelectedBrandToAdd(brand.slug);
        setActionError("Не удалось добавить бренд. Изменение отменено.");
      }
    });
  }

  return (
    <div>
      {attached.length > 0 ? (
        <SortableList
          items={attached}
          getId={(brand) => brand.brandSlug}
          onReorder={handleReorder}
          enableStepButtons
          renderItem={(brand) => (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40">
                {/* eslint-disable-next-line @next/next/no-img-element -- brand logos are SVGs, possibly hosted on Supabase Storage (external host) */}
                <img src={brand.brandLogo} alt="" className="max-h-full max-w-full object-contain p-1" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-card-foreground">{brand.brandName}</p>
              </div>
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                Масштаб
                <Input
                  type="number"
                  step="0.05"
                  value={brand.logoScaleOverride ?? ""}
                  onChange={(event) => {
                    const parsed = event.target.value.trim() ? Number(event.target.value) : null;
                    setAttached((previous) =>
                      previous.map((item) =>
                        item.brandSlug === brand.brandSlug
                          ? { ...item, logoScaleOverride: parsed !== null && Number.isFinite(parsed) ? parsed : undefined }
                          : item,
                      ),
                    );
                  }}
                  onBlur={(e) => handleOverrideBlur(brand.brandSlug, e.target.value)}
                  className="w-20"
                />
              </label>
              <button
                type="button"
                onClick={() => removeConfirm.request(brand)}
                className="shrink-0 rounded-md border border-danger-border px-3 py-1 text-sm font-medium text-danger transition-colors hover:bg-danger-surface"
              >
                Убрать
              </button>
            </div>
          )}
        />
      ) : (
        <EmptyState
          title="Бренды пока не привязаны"
          description="Выберите бренд ниже, чтобы он появился на публичной странице этой категории."
        />
      )}

      {available.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
          <Select
            aria-label="Добавить бренд"
            value={selectedBrandToAdd}
            onChange={(e) => setSelectedBrandToAdd(e.target.value)}
            className="max-w-xs"
          >
            <option value="">Выберите бренд…</option>
            {available.map((brand) => (
              <option key={brand.slug} value={brand.slug}>
                {brand.name}
              </option>
            ))}
          </Select>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!selectedBrandToAdd}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            Добавить
          </button>
        </div>
      )}
      <AdminActionFeedback message={actionError} onDismiss={() => setActionError(null)} />
      <ConfirmDialog
        open={removeConfirm.pending !== null}
        title={`Убрать бренд «${removeConfirm.pending?.brandName}» из этой категории?`}
        description="Бренд перестанет отображаться на публичной странице категории."
        cancelLabel="Отмена"
        confirmLabel="Убрать"
        tone="danger"
        onCancel={removeConfirm.cancel}
        onConfirm={removeConfirm.confirm}
      />
    </div>
  );
}
