"use client";

import { Checkbox } from "@/components/admin/ui/Checkbox";
import type { Brand, VehicleType } from "@/types/catalog";

interface ProductFormCompatibilitySectionProps {
  brands: Brand[];
  selectedBrands: Set<string>;
  onToggleBrand: (brandSlug: string) => void;
  onToggleAllBrands: () => void;
  vehicleTypes: VehicleType[];
  selectedVehicleTypes: Set<string>;
  onToggleVehicleType: (vehicleTypeSlug: string) => void;
  onToggleAllVehicleTypes: () => void;
}

export function ProductFormCompatibilitySection({
  brands,
  selectedBrands,
  onToggleBrand,
  onToggleAllBrands,
  vehicleTypes,
  selectedVehicleTypes,
  onToggleVehicleType,
  onToggleAllVehicleTypes,
}: ProductFormCompatibilitySectionProps) {
  const allBrandsSelected = brands.length > 0 && selectedBrands.size === brands.length;
  const allVehicleTypesSelected = vehicleTypes.length > 0 && selectedVehicleTypes.size === vehicleTypes.length;

  return (
    <>
      <fieldset>
        <div className="flex items-center justify-between gap-3">
          <legend className="text-sm font-medium text-card-foreground">Совместимые бренды</legend>
          {brands.length > 0 && (
            <button type="button" onClick={onToggleAllBrands} className="text-xs font-medium text-primary hover:underline">
              {allBrandsSelected ? "Снять все" : "Выбрать все"}
            </button>
          )}
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {brands.map((brand) => (
            <Checkbox
              key={brand.slug}
              id={`brand-${brand.slug}`}
              name="compatibleBrands"
              value={brand.slug}
              label={brand.name}
              checked={selectedBrands.has(brand.slug)}
              onChange={() => onToggleBrand(brand.slug)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <div className="flex items-center justify-between gap-3">
          <legend className="text-sm font-medium text-card-foreground">Тип спецтехники</legend>
          {vehicleTypes.length > 0 && (
            <button
              type="button"
              onClick={onToggleAllVehicleTypes}
              className="text-xs font-medium text-primary hover:underline"
            >
              {allVehicleTypesSelected ? "Снять все" : "Выбрать все"}
            </button>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">На какую технику подходит товар.</p>
        <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {vehicleTypes.map((vehicleType) => (
            <Checkbox
              key={vehicleType.slug}
              id={`vehicle-type-${vehicleType.slug}`}
              name="vehicleTypes"
              value={vehicleType.slug}
              label={vehicleType.name}
              checked={selectedVehicleTypes.has(vehicleType.slug)}
              onChange={() => onToggleVehicleType(vehicleType.slug)}
            />
          ))}
        </div>
      </fieldset>
    </>
  );
}
