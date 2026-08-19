"use client";

import Link from "next/link";
import { SortableList } from "@/components/admin/SortableList";
import { Toast } from "@/components/admin/ui/Toast";
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
  const { items: brands, handleReorder, removeItem, toast, dismissToast, highlightedKey, actionError, dismissActionError } = useAdminList<AdminBrand>({
    initial: initialBrands,
    getId: (brand) => brand.slug,
    reorder: reorderBrands,
    remove: deleteBrand,
    messages: { created: "Бренд успешно добавлен", updated: "Бренд успешно отредактирован" },
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
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40">
            {/* eslint-disable-next-line @next/next/no-img-element -- brand logos are SVGs, possibly hosted on Supabase Storage (external host) */}
            <img
              src={brand.logo}
              alt=""
              className="max-h-full max-w-full object-contain p-1"
              style={brand.logoScale ? { transform: `scale(${brand.logoScale})` } : undefined}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-card-foreground">{brand.name}</p>
            {(brand.productCount > 0 || brand.categoryCount > 0) && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {brand.productCount} тов. / {brand.categoryCount} кат.
              </p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">{brand.country}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Link
                href={`/admin/brands/${brand.slug}/edit`}
                className="rounded-md border border-border px-3 py-1 text-sm font-medium text-primary transition-colors hover:border-border-interactive hover:bg-accent"
              >
                Редактировать
              </Link>
              <button
                type="button"
                onClick={() => deleteConfirm.request(brand)}
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
