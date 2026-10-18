"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ChevronRight, MapPin, Trash2, Truck } from "lucide-react";
import { createVehicleType, updateVehicleType, deleteVehicleType } from "@/lib/admin/actions";
import type { FormActionState } from "@/lib/admin/actions";
import { describeVehicleTypeUsage } from "@/lib/admin/usage-descriptions";
import { slugify } from "@/lib/admin/slugify";
import { formatRussianCount } from "@/lib/russian-plural";
import { VEHICLE_VISUALS } from "@/lib/vehicle-visuals";
import { BackLink } from "@/components/admin/ui/BackLink";
import { FormField } from "@/components/admin/ui/FormField";
import { FormSection } from "@/components/admin/ui/FormSection";
import { Input } from "@/components/admin/ui/Input";
import { SubmitButton } from "@/components/admin/ui/SubmitButton";
import { AdminPageHeader } from "@/components/admin/ui/AdminPageHeader";
import { StickyFormActions } from "@/components/admin/ui/StickyFormActions";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import type { AdminVehicleType } from "@/lib/admin/queries";
import { buttonClassName } from "@/components/admin/ui/button-styles";

interface VehicleTypeFormProps {
  mode: "create" | "edit";
  vehicleType?: AdminVehicleType;
}

export function VehicleTypeForm({ mode, vehicleType }: VehicleTypeFormProps) {
  const [name, setName] = useState(vehicleType?.name ?? "");
  const [slug, setSlug] = useState(vehicleType?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(false);
  const [dismissedError, setDismissedError] = useState<FormActionState>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  function handleNameChange(value: string) {
    setName(value);
    if (mode === "create" && !slugTouched) {
      setSlug(slugify(value));
    }
  }

  function confirmDeleteVehicleType() {
    if (!vehicleType) return;
    setIsDeleteDialogOpen(false);
    deleteVehicleType(vehicleType.slug);
  }

  const boundAction = mode === "create" ? createVehicleType : updateVehicleType.bind(null, vehicleType!.slug);
  const [formState, formAction] = useActionState(boundAction, null);
  const actionError = formState !== dismissedError ? (formState?.error ?? null) : null;
  const visual = vehicleType ? VEHICLE_VISUALS[vehicleType.slug] : undefined;

  // The same layout as a brand or a category: fields on the left; on a laptop the photo and the actions sit in a
  // side column that stays in view, below xl the actions float at the bottom of the screen instead.
  const actions = (
    <>
      <SubmitButton pendingLabel={mode === "create" ? "Создание…" : "Сохранение…"} size="lg" className="flex-1">
        {mode === "create" ? "Создать тип техники" : "Сохранить"}
      </SubmitButton>
      <Link href="/admin/vehicle-types" className={buttonClassName({ variant: "glass", size: "lg" })}>
        Отмена
      </Link>
      {mode === "edit" && (
        <button
          type="button"
          onClick={() => setIsDeleteDialogOpen(true)}
          aria-label="Удалить тип техники"
          title="Удалить тип техники"
          className={buttonClassName({ variant: "ghost", size: "icon", className: "size-11 text-danger hover:bg-danger-surface hover:text-danger" })}
        >
          <Trash2 aria-hidden="true" />
        </button>
      )}
    </>
  );

  return (
    <div className="pb-4">
      <BackLink href="/admin/vehicle-types" label="Типы техники" />

      <form action={formAction} className="mt-3">
        <AdminPageHeader
          title={mode === "create" ? "Новый тип техники" : (vehicleType?.name ?? "Тип техники")}
          description={
            mode === "create"
              ? "Название. Адрес подставится сам."
              : vehicleType && vehicleType.productCount > 0
                ? formatRussianCount(vehicleType.productCount, ["товар подходит", "товара подходят", "товаров подходят"])
                : "Товаров пока нет"
          }
        />

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] xl:items-start">
          <FormSection id="vehicle-type-data" title="О технике">
            <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
              <FormField label="Название" htmlFor="name" required className="sm:col-span-2">
                <Input
                  id="name"
                  name="name"
                  required
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="font-medium sm:h-11 sm:text-[15px]"
                />
              </FormField>

              {mode === "create" ? (
                <FormField label="Адрес (slug)" htmlFor="slug" description="Заполняется из названия, можно изменить.">
                  <Input
                    id="slug"
                    name="slug"
                    value={slug}
                    spellCheck={false}
                    onChange={(e) => {
                      setSlug(e.target.value);
                      setSlugTouched(true);
                    }}
                  />
                </FormField>
              ) : (
                <FormField label="Адрес (slug)" htmlFor="slug-display" description="Не меняется: на этот адрес опираются связи с товарами.">
                  <Input id="slug-display" value={vehicleType?.slug ?? ""} disabled />
                </FormField>
              )}
            </div>
          </FormSection>

          <div className="flex flex-col gap-5 xl:sticky xl:top-3">
            {mode === "edit" && (
              <FormSection id="vehicle-type-photo" title="Фото" description="Так эта техника показана на главной странице сайта.">
                <div className="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-[14px] bg-surface-subtle [@media(max-height:760px)]:aspect-[16/8]">
                  {visual ? (
                    // eslint-disable-next-line @next/next/no-img-element -- static showcase photo, served as is in both builds
                    <img src={visual.imageMobile ?? visual.image} alt="" className="size-full scale-[1.25] object-cover" />
                  ) : (
                    <Truck aria-hidden="true" className="size-10 text-faint-foreground" />
                  )}
                </div>
                {visual && vehicleType && (
                  <Link
                    href={`/admin/vehicle-showcase?vehicle=${encodeURIComponent(vehicleType.slug)}`}
                    className="glass-plate group/link flex min-h-12 items-center gap-3 rounded-[12px] px-3 transition-colors duration-fast ease-ui hover:bg-secondary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
                  >
                    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-accent-strong text-accent-foreground">
                      <MapPin className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">Точки на фото</span>
                    <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground transition-[translate] duration-fast ease-ui group-hover/link:translate-x-0.5" />
                  </Link>
                )}
              </FormSection>
            )}
            <div className="glass-panel hidden items-center gap-2 rounded-[18px] p-3 xl:flex">{actions}</div>
          </div>
        </div>

        <StickyFormActions className="xl:hidden">{actions}</StickyFormActions>
      </form>
      <AdminActionFeedback message={actionError} onDismiss={() => setDismissedError(formState)} />
      <ConfirmDialog
        open={isDeleteDialogOpen}
        title={`Удалить тип техники «${vehicleType?.name}»?`}
        description={vehicleType ? `${describeVehicleTypeUsage(vehicleType)} Это действие необратимо.` : null}
        cancelLabel="Отмена"
        confirmLabel="Удалить"
        tone="danger"
        onCancel={() => setIsDeleteDialogOpen(false)}
        onConfirm={confirmDeleteVehicleType}
      />
    </div>
  );
}
