"use client";

import Link from "next/link";
import { Truck } from "lucide-react";
import { SortableList } from "@/components/admin/SortableList";
import { Toast } from "@/components/admin/ui/Toast";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import { reorderVehicleTypes, deleteVehicleType } from "@/lib/admin/actions";
import { describeVehicleTypeUsage } from "@/lib/admin/usage-descriptions";
import { useAdminList } from "@/lib/admin/use-admin-list";
import { useConfirmDelete } from "@/lib/admin/use-confirm-delete";
import type { AdminVehicleType } from "@/lib/admin/queries";

interface VehicleTypesListProps {
  vehicleTypes: AdminVehicleType[];
  flashSlug?: string;
  flashAction?: "created" | "updated";
}

export function VehicleTypesList({ vehicleTypes: initialVehicleTypes, flashSlug, flashAction }: VehicleTypesListProps) {
  const { items: vehicleTypes, handleReorder, removeItem, toast, dismissToast, highlightedKey, actionError, dismissActionError } =
    useAdminList<AdminVehicleType>({
      initial: initialVehicleTypes,
      getId: (vehicleType) => vehicleType.slug,
      reorder: reorderVehicleTypes,
      remove: deleteVehicleType,
      messages: { created: "Тип техники успешно добавлен", updated: "Тип техники успешно отредактирован" },
      flashSlug,
      flashAction,
    });

  const deleteConfirm = useConfirmDelete<AdminVehicleType>(removeItem);

  return (
    <>
    <SortableList
      className="mt-6"
      items={vehicleTypes}
      getId={(vehicleType) => vehicleType.slug}
      onReorder={handleReorder}
      highlightedKey={highlightedKey}
      renderItem={(vehicleType) => (
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Truck className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-card-foreground">{vehicleType.name}</p>
            {vehicleType.productCount > 0 && (
              <p className="mt-0.5 text-xs text-muted-foreground">{vehicleType.productCount} тов.</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Link
                href={`/admin/vehicle-types/${vehicleType.slug}/edit`}
                className="rounded-md border border-border px-3 py-1 text-sm font-medium text-primary transition-colors hover:border-border-interactive hover:bg-accent"
              >
                Редактировать
              </Link>
              <button
                type="button"
                onClick={() => deleteConfirm.request(vehicleType)}
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
      title={`Удалить тип техники «${deleteConfirm.pending?.name}»?`}
      description={deleteConfirm.pending ? `${describeVehicleTypeUsage(deleteConfirm.pending)} Это действие необратимо.` : null}
      cancelLabel="Отмена"
      confirmLabel="Удалить"
      tone="danger"
      onCancel={deleteConfirm.cancel}
      onConfirm={deleteConfirm.confirm}
    />
    </>
  );
}
