"use client";

import { useState, useTransition } from "react";
import { SortableList } from "@/components/admin/SortableList";
import { Input } from "@/components/admin/ui/Input";
import { Select } from "@/components/admin/ui/Select";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import {
  addCategoryBrand,
  removeCategoryBrand,
  updateCategoryBrandOverride,
  reorderCategoryBrands,
} from "@/lib/admin/actions";
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

  const attachedSlugs = new Set(attached.map((brand) => brand.brandSlug));
  const available = allBrands.filter((brand) => !attachedSlugs.has(brand.slug));

  function handleReorder(newAttached: AdminCategoryBrand[]) {
    const previous = attached;
    setAttached(newAttached);
    setActionError(null);
    startTransition(async () => {
      try {
        await reorderCategoryBrands(categorySlug, newAttached.map((brand) => brand.brandSlug));
      } catch {
        setAttached(previous);
        setActionError("Не удалось сохранить порядок брендов. Список возвращён в прежнее состояние.");
      }
    });
  }

  function handleRemove(brand: AdminCategoryBrand) {
    if (!confirm(`Убрать бренд «${brand.brandName}» из этой категории?`)) return;
    const previous = attached;
    setAttached((prev) => prev.filter((b) => b.brandSlug !== brand.brandSlug));
    setActionError(null);
    startTransition(async () => {
      try {
        await removeCategoryBrand(categorySlug, brand.brandSlug);
      } catch {
        setAttached(previous);
        setActionError("Не удалось убрать бренд. Связь восстановлена.");
      }
    });
  }

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
          renderItem={(brand) => (
            <div className="flex items-center gap-3">
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
                onClick={() => handleRemove(brand)}
                className="shrink-0 rounded-md border border-red-200 px-3 py-1 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
              >
                Убрать
              </button>
            </div>
          )}
        />
      ) : (
        <p className="text-sm text-muted-foreground">К этой категории пока не привязан ни один бренд.</p>
      )}

      {available.length > 0 && (
        <div className="mt-6 flex items-center gap-2 border-t border-border pt-6">
          <Select
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
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            Добавить
          </button>
        </div>
      )}
      <AdminActionFeedback message={actionError} onDismiss={() => setActionError(null)} />
    </div>
  );
}
