"use client";

import Link from "next/link";
import { SortableList } from "@/components/admin/SortableList";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import { reorderBrands, deleteBrand } from "@/lib/admin/actions";
import { describeBrandUsage } from "@/lib/admin/usage-descriptions";
import { useAdminList } from "@/lib/admin/use-admin-list";
import { useConfirmDelete } from "@/lib/admin/use-confirm-delete";
import type { AdminBrand } from "@/lib/admin/queries";

interface BrandsListProps {
  brands: AdminBrand[];
  flashSlug?: string;
  flashAction?: "created" | "updated";
}

export function BrandsList({ brands: initialBrands, flashSlug, flashAction }: BrandsListProps) {
  const { items: brands, handleReorder, removeItem, highlightedKey, actionError, dismissActionError } = useAdminList<AdminBrand>({
    initial: initialBrands,
    getId: (brand) => brand.slug,
    reorder: reorderBrands,
    remove: (slug) => deleteBrand(slug, false),
    messages: {
      created: "Бренд успешно добавлен",
      updated: "Бренд успешно отредактирован",
      deleted: "Бренд успешно удалён",
      reordered: "Порядок брендов сохранён",
    },
    flashSlug,
    flashAction,
  });

  const deleteConfirm = useConfirmDelete<AdminBrand>(removeItem);

  return (
    <>
    <SortableList
      className="mt-6"
      items={brands}
      getId={(brand) => brand.slug}
      onReorder={handleReorder}
      highlightedKey={highlightedKey}
      renderItem={(brand) => (
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-3 md:flex md:gap-3">
          <div className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40">
            {/* eslint-disable-next-line @next/next/no-img-element -- brand logos are SVGs, possibly hosted on Supabase Storage (external host) */}
            <img
              src={brand.logo}
              alt=""
              className="max-h-full max-w-full object-contain p-1"
              style={brand.logoScale ? { transform: `scale(${brand.logoScale})` } : undefined}
            />
          </div>
          <div className="contents md:block md:min-w-0 md:flex-1">
            <div className="min-w-0">
              <p className="text-sm font-medium text-card-foreground">{brand.name}</p>
              {(brand.productCount > 0 || brand.categoryCount > 0) && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {brand.productCount} тов. / {brand.categoryCount} кат.
                </p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">{brand.country}</p>
            </div>
            <div className="col-span-2 grid grid-cols-2 gap-2 border-t border-border pt-3 md:mt-2 md:flex md:flex-wrap md:items-center md:gap-3 md:border-0 md:pt-0">
              <Link
                href={`/admin/brands/${brand.slug}/edit`}
                className="flex min-h-11 items-center justify-center rounded-md border border-border px-3 py-1 text-sm font-medium text-primary transition-colors hover:border-border-interactive hover:bg-accent md:min-h-0"
              >
                Редактировать
              </Link>
              <button
                type="button"
                onClick={() => deleteConfirm.request(brand)}
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
      title={`Удалить бренд «${deleteConfirm.pending?.name}»?`}
      description={deleteConfirm.pending ? `${describeBrandUsage(deleteConfirm.pending)} Это действие необратимо.` : null}
      cancelLabel="Отмена"
      confirmLabel="Удалить"
      tone="danger"
      onCancel={deleteConfirm.cancel}
      onConfirm={deleteConfirm.confirm}
    />
    </>
  );
}
