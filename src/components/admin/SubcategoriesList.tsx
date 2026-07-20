"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { SortableList } from "@/components/admin/SortableList";
import { Toast } from "@/components/admin/ui/Toast";
import { reorderSubcategories, deleteSubcategory } from "@/lib/admin/actions";
import { useSaveFlowFlash } from "@/lib/admin/use-save-flow-flash";
import type { AdminSubcategory } from "@/lib/admin/queries";

export function SubcategoriesList({
  categorySlug,
  subcategories: initialSubcategories,
  flashSlug,
  flashAction,
}: {
  categorySlug: string;
  subcategories: AdminSubcategory[];
  flashSlug?: string;
  flashAction?: "created" | "updated";
}) {
  const [subcategories, setSubcategories] = useState(initialSubcategories);
  const [, startTransition] = useTransition();
  const { toast, dismissToast, highlightedKey } = useSaveFlowFlash({
    flashKey: flashSlug,
    flashAction,
    messages: { created: "Подкатегория успешно добавлена", updated: "Подкатегория успешно отредактирована" },
  });

  function handleReorder(newSubcategories: AdminSubcategory[]) {
    setSubcategories(newSubcategories);
    startTransition(() => {
      reorderSubcategories(categorySlug, newSubcategories.map((sub) => sub.id));
    });
  }

  function handleDelete(subcategory: AdminSubcategory) {
    if (subcategory.productCount > 0) {
      alert(
        `Нельзя удалить «${subcategory.name}» — в ней ${subcategory.productCount} товар(ов). Сначала перенесите или удалите их.`
      );
      return;
    }
    if (!confirm(`Удалить подкатегорию «${subcategory.name}»? Это действие необратимо.`)) return;

    setSubcategories((prev) => prev.filter((s) => s.id !== subcategory.id));
    startTransition(() => {
      deleteSubcategory(subcategory.id);
    });
  }

  return (
    <>
    <SortableList
      className="mt-6"
      items={subcategories}
      getId={(sub) => sub.id}
      getFlashKey={(sub) => sub.slug}
      onReorder={handleReorder}
      highlightedKey={highlightedKey}
      renderItem={(sub) => (
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40">
            {/* eslint-disable-next-line @next/next/no-img-element -- possibly hosted on Supabase Storage (external host) */}
            <img src={sub.image} alt="" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-card-foreground">{sub.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{sub.productCount} тов.</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Link
                href={`/admin/categories/${categorySlug}/subcategories/${sub.slug}/edit`}
                className="rounded-md border border-border px-3 py-1 text-sm font-medium text-primary transition-colors hover:border-blue-200 hover:bg-accent"
              >
                Редактировать
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(sub)}
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
