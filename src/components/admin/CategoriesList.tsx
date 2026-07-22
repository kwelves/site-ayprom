"use client";

import Link from "next/link";
import { SortableList } from "@/components/admin/SortableList";
import { Toast } from "@/components/admin/ui/Toast";
import { reorderCategories, deleteCategory } from "@/lib/admin/actions";
import { describeCategoryUsage } from "@/lib/admin/queries";
import { useAdminList } from "@/lib/admin/use-admin-list";
import { cn } from "@/lib/utils";
import type { AdminCategory } from "@/lib/admin/queries";

interface CategoriesListProps {
  categories: AdminCategory[];
  flashSlug?: string;
  flashAction?: "created" | "updated";
}

export function CategoriesList({ categories: initialCategories, flashSlug, flashAction }: CategoriesListProps) {
  const { items: categories, handleReorder, removeItem, toast, dismissToast, highlightedKey } =
    useAdminList<AdminCategory>({
      initial: initialCategories,
      getId: (category) => category.slug,
      reorder: reorderCategories,
      remove: deleteCategory,
      messages: { created: "Категория успешно добавлена", updated: "Категория успешно отредактирована" },
      flashSlug,
      flashAction,
    });

  function handleDelete(category: AdminCategory) {
    if (category.productCount > 0) {
      alert(
        `Нельзя удалить «${category.name}» — в категории ${category.productCount} товар(ов). Сначала перенесите или удалите их.`
      );
      return;
    }
    if (!confirm(`Удалить категорию «${category.name}»?${describeCategoryUsage(category)} Это действие необратимо.`)) {
      return;
    }
    removeItem(category);
  }

  return (
    <>
    <SortableList
      className="mt-6"
      items={categories}
      getId={(category) => category.slug}
      onReorder={handleReorder}
      highlightedKey={highlightedKey}
      renderItem={(category) => (
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40">
            {/* eslint-disable-next-line @next/next/no-img-element -- possibly hosted on Supabase Storage (external host) */}
            <img src={category.image} alt="" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-card-foreground">{category.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{category.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  category.type === "brand" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700"
                )}
              >
                {category.type === "brand" ? "По брендам" : "По подкатегориям"}
              </span>
              <span className="text-xs text-muted-foreground">{category.productCount} тов.</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Link
                href={`/admin/categories/${category.slug}/edit`}
                className="rounded-md border border-border px-3 py-1 text-sm font-medium text-primary transition-colors hover:border-blue-200 hover:bg-accent"
              >
                Редактировать
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(category)}
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
