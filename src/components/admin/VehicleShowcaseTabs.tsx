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
      <nav aria-label="Выбор типа техники" className="mt-6 flex flex-wrap gap-2">
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
                  ? "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                  : "rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-border-interactive hover:bg-accent hover:text-foreground"
              }
            >
              {vehicleType.name}
            </button>
          );
        })}
      </nav>

      {selectedHotspots.length === 0 ? (
        <div className="mt-6 rounded-lg border border-border bg-card p-4">
          <h2 className="text-base font-semibold text-card-foreground">{selectedVehicle.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Для этого типа техники хотспоты ещё не настроены. Здесь нельзя создавать или перемещать точки.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6">
            <VehicleHotspotPreview vehicleTypeSlug={selectedVehicle.slug} hotspots={selectedHotspots} />
          </div>
          <VehicleShowcaseEditor
            key={selectedVehicle.slug}
            vehicleTypeSlug={selectedVehicle.slug}
            vehicleTypeName={selectedVehicle.name}
            hotspots={selectedHotspots}
          />
        </>
      )}
    </>
  );
}
