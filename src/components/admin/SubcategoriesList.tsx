"use client";

import Link from "next/link";
import Image from "next/image";
import { Pencil, Trash2 } from "lucide-react";
import { SortableList } from "@/components/admin/SortableList";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import { reorderSubcategories, deleteSubcategory } from "@/lib/admin/actions";
import { useAdminList } from "@/lib/admin/use-admin-list";
import { useConfirmDelete } from "@/lib/admin/use-confirm-delete";
import { formatRussianCount } from "@/lib/russian-plural";
import type { AdminSubcategory } from "@/lib/admin/queries";
import { buttonClassName } from "@/components/admin/ui/button-styles";

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
        `Нельзя удалить «${subcategory.name}»: в ней ${formatRussianCount(subcategory.productCount, ["товар", "товара", "товаров"])}. Сначала перенесите или удалите их.`
      );
      return;
    }
    deleteConfirm.request(subcategory);
  }

  return (
    <>
    {/* The same card grid as the categories: picture on top, name and count, one row of actions at the bottom. */}
    <SortableList
      className="mt-6"
      surface="grid"
      items={subcategories}
      getId={(sub) => sub.id}
      getFlashKey={(sub) => sub.slug}
      onReorder={handleReorder}
      highlightedKey={highlightedKey}
      renderItem={(sub) => (
        <div className="flex h-full flex-col">
          <Link
            href={`/admin/categories/${categorySlug}/subcategories/${sub.slug}/edit`}
            aria-label={`Редактировать подкатегорию «${sub.name}»`}
            tabIndex={-1}
            className="relative block aspect-[16/10] overflow-hidden rounded-[12px] bg-surface-subtle"
          >
            <Image
              src={sub.image}
              alt=""
              fill
              sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"
              unoptimized
              className="object-cover transition-[scale] duration-slow ease-ui group-hover/card:scale-[1.03]"
            />
          </Link>
          <div className="flex flex-1 flex-col px-1.5 pt-3 pb-1">
            <p className="text-[15px] leading-snug font-semibold tracking-[-0.01em] text-foreground">{sub.name}</p>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {formatRussianCount(sub.productCount, ["товар", "товара", "товаров"])}
            </p>
            <div className="mt-auto flex items-center gap-1.5 pt-4">
              <Link
                href={`/admin/categories/${categorySlug}/subcategories/${sub.slug}/edit`}
                className={buttonClassName({ variant: "soft", size: "sm", className: "min-h-11 flex-1 md:min-h-0" })}
              >
                <Pencil aria-hidden="true" className="!size-4" />
                Редактировать
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(sub)}
                aria-label="Удалить"
                title={`Удалить подкатегорию «${sub.name}»`}
                className={buttonClassName({ variant: "ghost", size: "icon", className: "text-danger hover:bg-danger-surface hover:text-danger" })}
              >
                <Trash2 aria-hidden="true" />
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
