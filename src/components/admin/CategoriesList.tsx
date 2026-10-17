"use client";

import Link from "next/link";
import Image from "next/image";
import { ChevronRight, Pencil, Trash2 } from "lucide-react";
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
import { buttonClassName } from "@/components/admin/ui/button-styles";

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
        `Нельзя удалить «${category.name}»: в категории ${formatRussianCount(category.productCount, ["товар", "товара", "товаров"])}. Сначала перенесите или удалите их.`
      );
      return;
    }
    deleteConfirm.request(category);
  }

  return (
    <>
    {/* About a dozen categories, each led by its picture: a grid of cards shows them all at once. Drag a card by
        its handle to change the order on the site. */}
    <SortableList
      className="mt-6"
      surface="grid"
      items={categories}
      getId={(category) => category.slug}
      onReorder={handleReorder}
      highlightedKey={highlightedKey}
      renderItem={(category) => (
        <div className="flex h-full flex-col">
          <Link
            href={`/admin/categories/${category.slug}/edit`}
            aria-label={`Редактировать категорию «${category.name}»`}
            tabIndex={-1}
            className="relative block aspect-[16/10] overflow-hidden rounded-[12px] bg-surface-subtle"
          >
            <Image
              src={category.image}
              alt=""
              fill
              sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"
              unoptimized
              className="object-cover transition-[scale] duration-slow ease-ui group-hover/card:scale-[1.03]"
            />
          </Link>
          <div className="flex flex-1 flex-col px-1.5 pt-3 pb-1">
            <p className="text-[15px] leading-snug font-semibold tracking-[-0.01em] text-foreground">{category.name}</p>
            {category.description && <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted-foreground">{category.description}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {category.type === null ? (
                <span className="inline-flex h-6 items-center rounded-full bg-neutral-surface px-2.5 text-xs font-semibold text-muted-foreground">
                  Напрямую
                </span>
              ) : (
                // The type chip is also the way into the category's brands or subcategories.
                <Link
                  href={category.type === "brand" ? `/admin/categories/${category.slug}/category-brands` : `/admin/categories/${category.slug}/subcategories`}
                  title={category.type === "brand" ? "Открыть бренды категории" : "Открыть подкатегории"}
                  className={cn(
                    "inline-flex h-6 items-center gap-0.5 rounded-full pr-1.5 pl-2.5 text-xs font-semibold transition-colors duration-fast ease-ui focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30",
                    category.type === "brand"
                      ? "bg-info-surface text-info hover:bg-accent-strong"
                      : "bg-neutral-surface text-muted-foreground hover:bg-surface-strong hover:text-foreground",
                  )}
                >
                  {category.type === "brand" ? "По брендам" : "По подкатегориям"}
                  <ChevronRight aria-hidden="true" className="size-3.5" />
                </Link>
              )}
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatRussianCount(category.productCount, ["товар", "товара", "товаров"])}
                {category.type === "subcategory" && category.directProductCount > 0
                  ? ` · ${category.directProductCount} без подкат.`
                  : ""}
              </span>
            </div>
            <div className="mt-auto flex items-center gap-1.5 pt-4">
              <Link
                href={`/admin/categories/${category.slug}/edit`}
                className={buttonClassName({ variant: "soft", size: "sm", className: "min-h-11 flex-1 md:min-h-0" })}
              >
                <Pencil aria-hidden="true" className="!size-4" />
                Редактировать
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(category)}
                aria-label="Удалить"
                title={`Удалить категорию «${category.name}»`}
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
