"use client";

import Link from "next/link";
import { Pencil, Trash2, Truck } from "lucide-react";
import { VEHICLE_VISUALS } from "@/lib/vehicle-visuals";
import { formatRussianCount } from "@/lib/russian-plural";
import { SortableList } from "@/components/admin/SortableList";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import { reorderVehicleTypes, deleteVehicleType } from "@/lib/admin/actions";
import { describeVehicleTypeUsage } from "@/lib/admin/usage-descriptions";
import { useAdminList } from "@/lib/admin/use-admin-list";
import { useConfirmDelete } from "@/lib/admin/use-confirm-delete";
import type { AdminVehicleType } from "@/lib/admin/queries";
import { buttonClassName } from "@/components/admin/ui/button-styles";

interface VehicleTypesListProps {
  vehicleTypes: AdminVehicleType[];
  flashSlug?: string;
  flashAction?: "created" | "updated";
}

export function VehicleTypesList({ vehicleTypes: initialVehicleTypes, flashSlug, flashAction }: VehicleTypesListProps) {
  const { items: vehicleTypes, handleReorder, removeItem, highlightedKey, actionError, dismissActionError } =
    useAdminList<AdminVehicleType>({
      initial: initialVehicleTypes,
      getId: (vehicleType) => vehicleType.slug,
      reorder: reorderVehicleTypes,
      remove: (slug) => deleteVehicleType(slug, false),
      messages: {
        created: "Тип техники успешно добавлен",
        updated: "Тип техники успешно отредактирован",
        deleted: "Тип техники успешно удалён",
        reordered: "Порядок типов техники сохранён",
      },
      flashSlug,
      flashAction,
    });

  const deleteConfirm = useConfirmDelete<AdminVehicleType>(removeItem);

  return (
    <>
    {/* Each vehicle type with its own photo (the same picture the home page shows), as a grid of cards. */}
    <SortableList
      className="mt-6"
      surface="grid"
      items={vehicleTypes}
      getId={(vehicleType) => vehicleType.slug}
      onReorder={handleReorder}
      highlightedKey={highlightedKey}
      renderItem={(vehicleType) => {
        const visual = VEHICLE_VISUALS[vehicleType.slug];
        return (
          <div className="flex h-full flex-col">
            <Link
              href={`/admin/vehicle-types/${vehicleType.slug}/edit`}
              aria-label={`Редактировать тип техники «${vehicleType.name}»`}
              tabIndex={-1}
              className="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-[12px] bg-surface-subtle"
            >
              {visual ? (
                // eslint-disable-next-line @next/next/no-img-element -- static showcase photo, served as is in both builds
                <img
                  src={visual.imageMobile ?? visual.image}
                  alt=""
                  className="size-full scale-[1.35] object-cover transition-[scale] duration-slow ease-ui group-hover/card:scale-[1.4]"
                />
              ) : (
                <Truck aria-hidden="true" className="size-10 text-faint-foreground" />
              )}
            </Link>
            <div className="flex flex-1 flex-col px-1.5 pt-3 pb-1">
              <p className="text-[15px] leading-snug font-semibold tracking-[-0.01em] text-foreground">{vehicleType.name}</p>
              <p className="mt-1 text-[13px] text-muted-foreground tabular-nums">
                {vehicleType.productCount > 0
                  ? formatRussianCount(vehicleType.productCount, ["товар подходит", "товара подходят", "товаров подходят"])
                  : "Товаров пока нет"}
              </p>
              <div className="mt-auto flex items-center gap-1.5 pt-4">
                <Link
                  href={`/admin/vehicle-types/${vehicleType.slug}/edit`}
                  className={buttonClassName({ variant: "soft", size: "sm", className: "min-h-11 flex-1 md:min-h-0" })}
                >
                  <Pencil aria-hidden="true" className="!size-4" />
                  Редактировать
                </Link>
                <button
                  type="button"
                  onClick={() => deleteConfirm.request(vehicleType)}
                  aria-label="Удалить"
                  title={`Удалить тип техники «${vehicleType.name}»`}
                  className={buttonClassName({ variant: "ghost", size: "icon", className: "ml-auto text-danger hover:bg-danger-surface hover:text-danger" })}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        );
      }}
    />
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
