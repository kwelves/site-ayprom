"use client";

import Link from "next/link";
import Image from "next/image";
import { SortableList } from "@/components/admin/SortableList";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import { reorderCategories, deleteCategory } from "@/lib/admin/actions";
import { describeCategoryUsage } from "@/lib/admin/usage-descriptions";
import { formatRussianCount } from "@/lib/russian-plural";
import { useAdminList } from "@/lib/admin/use-admin-list";
import { useConfirmDelete } from "@/lib/admin/use-confirm-delete";
import { cn } from "@/lib/utils";
import type { AdminCategory } from "@/lib/admin/queries";

interface CategoriesListProps {
  categories: AdminCategory[];
  flashSlug?: string;
  flashAction?: "created" | "updated";
}

export function CategoriesList({ categories: initialCategories, flashSlug, flashAction }: CategoriesListProps) {
  const { items: categories, handleReorder, removeItem, highlightedKey, actionError, dismissActionError } =
    useAdminList<AdminCategory>({
      initial: initialCategories,
      getId: (category) => category.slug,
      reorder: reorderCategories,
      remove: (slug) => deleteCategory(slug, false),
      messages: {
        created: "Категория успешно добавлена",
        updated: "Категория успешно отредактирована",
        deleted: "Категория успешно удалена",
        reordered: "Порядок категорий сохранён",
      },
      flashSlug,
      flashAction,
    });

  const deleteConfirm = useConfirmDelete<AdminCategory>(removeItem);

  function handleDelete(category: AdminCategory) {
    if (category.productCount > 0) {
      alert(
        `Нельзя удалить «${category.name}» — в категории ${formatRussianCount(category.productCount, ["товар", "товара", "товаров"])}. Сначала перенесите или удалите их.`
      );
      return;
    }
    deleteConfirm.request(category);
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
        <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-x-3 gap-y-3 md:flex md:gap-3">
          <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40">
            <Image src={category.image} alt="" width={64} height={48} className="h-full w-full object-cover" />
          </div>
          <div className="contents md:block md:min-w-0 md:flex-1">
            <div className="min-w-0">
              <p className="text-sm font-medium text-card-foreground">{category.name}</p>
              {category.description && <p className="mt-0.5 text-xs text-muted-foreground">{category.description}</p>}
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
                <span className="text-xs text-muted-foreground">
                  {category.productCount} тов.
                  {category.type === "subcategory" && category.directProductCount > 0
                    ? ` · ${category.directProductCount} без подкат.`
                    : ""}
                </span>
              </div>
            </div>
            <div className="col-span-2 grid grid-cols-2 gap-2 border-t border-border pt-3 md:mt-2 md:flex md:flex-wrap md:items-center md:gap-3 md:border-0 md:pt-0">
              <Link
                href={`/admin/categories/${category.slug}/edit`}
                className="flex min-h-11 items-center justify-center rounded-md border border-border px-3 py-1 text-sm font-medium text-primary transition-colors hover:border-border-interactive hover:bg-accent md:min-h-0"
              >
                Редактировать
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(category)}
                className="flex min-h-11 items-center justify-center rounded-md border border-danger-border px-3 py-1 text-sm font-medium text-danger transition-colors hover:bg-danger-surface md:min-h-0"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    />
    <AdminActionFeedback message={actionError} onDismiss={dismissActionError} />
    <ConfirmDialog
      open={deleteConfirm.pending !== null}
      title={`Удалить категорию «${deleteConfirm.pending?.name}»?`}
      description={deleteConfirm.pending ? `${describeCategoryUsage(deleteConfirm.pending)} Это действие необратимо.` : null}
      cancelLabel="Отмена"
      confirmLabel="Удалить"
      tone="danger"
      onCancel={deleteConfirm.cancel}
      onConfirm={deleteConfirm.confirm}
    />
    </>
  );
}
