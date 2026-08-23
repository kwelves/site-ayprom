"use client";

import Link from "next/link";
import Image from "next/image";
import { SortableList } from "@/components/admin/SortableList";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import { reorderSubcategories, deleteSubcategory } from "@/lib/admin/actions";
import { useAdminList } from "@/lib/admin/use-admin-list";
import { useConfirmDelete } from "@/lib/admin/use-confirm-delete";
import { formatRussianCount } from "@/lib/russian-plural";
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
  const { items: subcategories, handleReorder, removeItem, highlightedKey, actionError, dismissActionError } =
    useAdminList<AdminSubcategory>({
      initial: initialSubcategories,
      getId: (sub) => sub.id,
      reorder: (ids) => reorderSubcategories(categorySlug, ids),
      remove: (id) => deleteSubcategory(id, false),
      messages: {
        created: "Подкатегория успешно добавлена",
        updated: "Подкатегория успешно отредактирована",
        deleted: "Подкатегория успешно удалена",
        reordered: "Порядок подкатегорий сохранён",
      },
      flashSlug,
      flashAction,
    });

  const deleteConfirm = useConfirmDelete<AdminSubcategory>(removeItem);

  function handleDelete(subcategory: AdminSubcategory) {
    if (subcategory.productCount > 0) {
      alert(
        `Нельзя удалить «${subcategory.name}» — в ней ${formatRussianCount(subcategory.productCount, ["товар", "товара", "товаров"])}. Сначала перенесите или удалите их.`
      );
      return;
    }
    deleteConfirm.request(subcategory);
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
            <Image src={sub.image} alt="" width={64} height={48} className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-card-foreground">{sub.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{sub.productCount} тов.</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Link
                href={`/admin/categories/${categorySlug}/subcategories/${sub.slug}/edit`}
                className="rounded-md border border-border px-3 py-1 text-sm font-medium text-primary transition-colors hover:border-border-interactive hover:bg-accent"
              >
                Редактировать
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(sub)}
                className="rounded-md border border-danger-border px-3 py-1 text-sm font-medium text-danger transition-colors hover:bg-danger-surface"
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
      title={`Удалить подкатегорию «${deleteConfirm.pending?.name}»?`}
      description="Это действие необратимо."
      cancelLabel="Отмена"
      confirmLabel="Удалить"
      tone="danger"
      onCancel={deleteConfirm.cancel}
      onConfirm={deleteConfirm.confirm}
    />
    </>
  );
}
