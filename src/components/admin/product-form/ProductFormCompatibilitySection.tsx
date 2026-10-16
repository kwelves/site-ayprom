"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
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

// Brands and vehicle types as chips (design system v2, "Чипы"): what is chosen is visible at a glance, blue with a
// check; one tap toggles. Each chip is a real checkbox, so the form submits the same values as before.
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
  return (
    <>
      <ChipGroup
        legend="Совместимые бренды"
        name="compatibleBrands"
        idPrefix="brand"
        items={brands}
        selected={selectedBrands}
        onToggle={onToggleBrand}
        onToggleAll={onToggleAllBrands}
      />
      <ChipGroup
        legend="Тип спецтехники"
        hint="На какую технику подходит товар."
        name="vehicleTypes"
        idPrefix="vehicle-type"
        items={vehicleTypes}
        selected={selectedVehicleTypes}
        onToggle={onToggleVehicleType}
        onToggleAll={onToggleAllVehicleTypes}
      />
    </>
  );
}

function ChipGroup({
  legend,
  hint,
  name,
  idPrefix,
  items,
  selected,
  onToggle,
  onToggleAll,
}: {
  legend: string;
  hint?: string;
  name: string;
  idPrefix: string;
  items: { slug: string; name: string }[];
  selected: Set<string>;
  onToggle: (slug: string) => void;
  onToggleAll: () => void;
}) {
  const allSelected = items.length > 0 && selected.size === items.length;
  return (
    <fieldset>
      <div className="flex items-center justify-between gap-3">
        <legend className="text-[13px] font-medium text-foreground">
          {legend}
          <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
            {selected.size} из {items.length}
          </span>
        </legend>
        {items.length > 0 && (
          <button
            type="button"
            onClick={onToggleAll}
            className="rounded-[8px] px-1.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
          >
            {allSelected ? "Снять все" : "Выбрать все"}
          </button>
        )}
      </div>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {items.map((item) => {
          const checked = selected.has(item.slug);
          return (
            <label
              key={item.slug}
              className={cn(
                "group/chip relative inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-[background-color,border-color,color,scale] duration-fast ease-ui select-none active:scale-[0.97] has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-primary/30 sm:h-[30px]",
                checked
                  ? "border-border-accent bg-accent-strong text-accent-foreground"
                  : "glass-plate text-muted-foreground hover:text-foreground",
              )}
            >
              <input
                type="checkbox"
                id={`${idPrefix}-${item.slug}`}
                name={name}
                value={item.slug}
                checked={checked}
                onChange={() => onToggle(item.slug)}
                className="sr-only"
              />
              <Check
                aria-hidden="true"
                strokeWidth={2.5}
                className={cn(
                  "size-3.5 transition-[opacity,scale,margin] duration-base ease-spring-soft",
                  checked ? "scale-100 opacity-100" : "-mr-5 scale-50 opacity-0",
                )}
              />
              {item.name}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
