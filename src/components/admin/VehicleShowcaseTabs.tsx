"use client";

import { useState } from "react";
import { VehicleHotspotPreview } from "@/components/admin/VehicleHotspotPreview";
import { VehicleShowcaseEditor } from "@/components/admin/VehicleShowcaseEditor";
import type { AdminVehicleHotspot, AdminVehicleType } from "@/lib/admin/queries";

interface VehicleShowcaseTabsProps {
  vehicleTypes: AdminVehicleType[];
  hotspots: AdminVehicleHotspot[];
  initialVehicleTypeSlug: string;
}

export function VehicleShowcaseTabs({
  vehicleTypes,
  hotspots,
  initialVehicleTypeSlug,
}: VehicleShowcaseTabsProps) {
  const [selectedSlug, setSelectedSlug] = useState(initialVehicleTypeSlug);
  const selectedVehicle = vehicleTypes.find((vehicleType) => vehicleType.slug === selectedSlug) ?? vehicleTypes[0];
  const selectedHotspots = hotspots.filter((hotspot) => hotspot.vehicleTypeSlug === selectedVehicle.slug);

  function selectVehicle(slug: string) {
    setSelectedSlug(slug);
    const url = new URL(window.location.href);
    url.searchParams.set("vehicle", slug);
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <>
      <nav aria-label="Выбор типа техники" className="glass-plate mt-5 flex w-fit max-w-full flex-wrap gap-0.5 rounded-[14px] p-1">
        {vehicleTypes.map((vehicleType) => {
          const active = vehicleType.slug === selectedVehicle.slug;
          return (
            <button
              key={vehicleType.slug}
              type="button"
              onClick={() => selectVehicle(vehicleType.slug)}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "h-10 rounded-[10px] bg-secondary px-4 text-[13px] font-semibold text-foreground shadow-[inset_0_1px_0_var(--color-glass-highlight),0_0_0_1px_var(--color-glass-edge)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
                  : "h-10 rounded-[10px] px-4 text-[13px] font-medium text-muted-foreground transition-colors duration-fast ease-ui hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
              }
            >
              {vehicleType.name}
            </button>
          );
        })}
      </nav>

      {selectedHotspots.length === 0 ? (
        <div className="glass-panel mt-5 rounded-[18px] p-4">
          <h2 className="text-base font-semibold text-foreground">{selectedVehicle.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Для этого типа техники точки ещё не настроены. Здесь их нельзя создавать или переносить.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,460px)] xl:items-start">
          <VehicleShowcaseEditor
            key={selectedVehicle.slug}
            vehicleTypeSlug={selectedVehicle.slug}
            vehicleTypeName={selectedVehicle.name}
            hotspots={selectedHotspots}
          />
          <div className="xl:sticky xl:top-3">
            <VehicleHotspotPreview
              key={selectedVehicle.slug}
              vehicleTypeSlug={selectedVehicle.slug}
              hotspots={selectedHotspots}
            />
          </div>
        </div>
      )}
    </>
  );
}
