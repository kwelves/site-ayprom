"use client";

import { useState } from "react";
import { createVehicleType, updateVehicleType, deleteVehicleType } from "@/lib/admin/actions";
import { describeVehicleTypeUsage } from "@/lib/admin/queries";
import { slugify } from "@/lib/admin/slugify";
import { BackLink } from "@/components/admin/ui/BackLink";
import { FormField } from "@/components/admin/ui/FormField";
import { Input } from "@/components/admin/ui/Input";
import { SubmitButton } from "@/components/admin/ui/SubmitButton";
import type { AdminVehicleType } from "@/lib/admin/queries";

interface VehicleTypeFormProps {
  mode: "create" | "edit";
  vehicleType?: AdminVehicleType;
}

export function VehicleTypeForm({ mode, vehicleType }: VehicleTypeFormProps) {
  const [name, setName] = useState(vehicleType?.name ?? "");
  const [slug, setSlug] = useState(vehicleType?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(false);

  function handleNameChange(value: string) {
    setName(value);
    if (mode === "create" && !slugTouched) {
      setSlug(slugify(value));
    }
  }

  function handleDeleteVehicleType() {
    if (!vehicleType) return;
    if (
      !confirm(
        `Удалить тип техники «${vehicleType.name}»?${describeVehicleTypeUsage(vehicleType)} Это действие необратимо.`
      )
    ) {
      return;
    }
    deleteVehicleType(vehicleType.slug);
  }

  const action = mode === "create" ? createVehicleType : updateVehicleType.bind(null, vehicleType!.slug);

  return (
    <div className="max-w-xl">
      <BackLink href="/admin/vehicle-types" label="Типы техники" />

      <form action={action} className="mt-4 space-y-6">
        <h1 className="text-xl font-semibold text-foreground">
          {mode === "create" ? "Новый тип техники" : `Редактировать: ${vehicleType?.name}`}
        </h1>

        <FormField label="Название" htmlFor="name">
          <Input id="name" name="name" required value={name} onChange={(e) => handleNameChange(e.target.value)} />
        </FormField>

        {mode === "create" ? (
          <FormField
            label="Адрес (slug)"
            htmlFor="slug"
            description="Заполняется автоматически из названия, можно изменить."
          >
            <Input
              id="slug"
              name="slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
            />
          </FormField>
        ) : (
          <FormField label="Адрес (slug)" htmlFor="slug-display" description="Нельзя изменить — используется в связях.">
            <Input id="slug-display" value={vehicleType?.slug ?? ""} disabled />
          </FormField>
        )}

        <div className="flex items-center gap-4 border-t border-border pt-6">
          <SubmitButton pendingLabel={mode === "create" ? "Создание..." : "Сохранение..."}>
            {mode === "create" ? "Создать тип техники" : "Сохранить"}
          </SubmitButton>
          {mode === "edit" && (
            <button type="button" onClick={handleDeleteVehicleType} className="text-sm text-red-600 hover:underline">
              Удалить тип техники
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
