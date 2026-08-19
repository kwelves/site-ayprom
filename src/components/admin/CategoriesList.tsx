"use client";

import Link from "next/link";
import Image from "next/image";
import { SortableList } from "@/components/admin/SortableList";
import { Toast } from "@/components/admin/ui/Toast";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import { reorderCategories, deleteCategory } from "@/lib/admin/actions";
import { describeCategoryUsage } from "@/lib/admin/usage-descriptions";
import { formatRussianCount } from "@/lib/russian-plural";
import { useAdminList } from "@/lib/admin/use-admin-list";
import { cn } from "@/lib/utils";
import type { AdminCategory } from "@/lib/admin/queries";

interface CategoriesListProps {
  categories: AdminCategory[];
  flashSlug?: string;
  flashAction?: "created" | "updated";
}

export function CategoriesList({ categories: initialCategories, flashSlug, flashAction }: CategoriesListProps) {
  const { items: categories, handleReorder, removeItem, toast, dismissToast, highlightedKey, actionError, dismissActionError } =
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
        `Нельзя удалить «${category.name}» — в категории ${formatRussianCount(category.productCount, ["товар", "товара", "товаров"])}. Сначала перенесите или удалите их.`
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
            <Image src={category.image} alt="" width={64} height={48} className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-card-foreground">{category.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{category.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  category.type === "brand"
                    ? "bg-accent-strong text-accent-foreground"
                    : category.type === "subcategory"
                      ? "bg-surface-subtle text-muted-foreground"
                      : "bg-muted text-muted-foreground"
                )}
              >
                {category.type === "brand" ? "По брендам" : category.type === "subcategory" ? "По подкатегориям" : "Напрямую"}
              </span>
              <span className="text-xs text-muted-foreground">{category.productCount} тов.</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Link
                href={`/admin/categories/${category.slug}/edit`}
                className="rounded-md border border-border px-3 py-1 text-sm font-medium text-primary transition-colors hover:border-border-interactive hover:bg-accent"
              >
                Редактировать
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(category)}
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
    <AdminActionFeedback message={actionError} onDismiss={dismissActionError} />
    </>
  );
}
