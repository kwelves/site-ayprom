"use client";

import { useRef } from "react";
import Image from "next/image";
import { useContainRect } from "@/components/home/vehicle-showcase/useContainRect";
import { VEHICLE_VISUALS } from "@/lib/vehicle-visuals";

interface PreviewHotspot {
  id: string;
  hotspotNumber: number;
  label: string;
  xPct: number;
  yPct: number;
}

interface VehicleHotspotPreviewProps {
  vehicleTypeSlug: string;
  hotspots: PreviewHotspot[];
}

/**
 * Read-only reference photo for the editor below it: shows exactly where
 * each numbered hotspot sits on the real vehicle photo, using the same
 * VEHICLE_VISUALS entry and contain-fit math (useContainRect) as the public
 * showcase — see getAdminVehicleHotspots for why x_pct/y_pct are read-only
 * here. Nothing in this component writes anything back; there is no drag,
 * no click handler on the dots.
 */
export function VehicleHotspotPreview({ vehicleTypeSlug, hotspots }: VehicleHotspotPreviewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const visual = VEHICLE_VISUALS[vehicleTypeSlug];
  const containRect = useContainRect(stageRef, visual?.naturalWidth ?? 1, visual?.naturalHeight ?? 1, visual?.scale ?? 1);

  if (!visual) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm font-medium text-card-foreground">Расположение точек на фото</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Только для справки — позиция и нумерация здесь не редактируются.
      </p>
      <div ref={stageRef} className="relative mt-3 aspect-4/3 w-full overflow-hidden rounded-md bg-muted/40">
        {/* Same pre-built static file the public stage uses (see
            scripts/generate-vehicle-webp.mjs) — `unoptimized` for the same
            reason it's used there: this is already the exact file to serve,
            not something next/image needs to resize or re-encode. */}
        {containRect.width > 0 && (
          <Image
            src={visual.image}
            alt=""
            width={Math.round(containRect.width)}
            height={Math.round(containRect.height)}
            unoptimized
            className="absolute max-w-none"
            style={{
              left: containRect.left,
              top: containRect.top,
              width: containRect.width,
              height: containRect.height,
            }}
          />
        )}
        {containRect.width > 0 && hotspots.map((hotspot) => (
          <div
            key={hotspot.id}
            aria-hidden="true"
            className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
            style={{
              left: containRect.left + (hotspot.xPct / 100) * containRect.width,
              top: containRect.top + (hotspot.yPct / 100) * containRect.height,
            }}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-inverse-foreground/40 bg-primary text-xs font-semibold text-primary-foreground shadow-sm">
              {hotspot.hotspotNumber}
            </span>
            <span className="whitespace-nowrap rounded bg-inverse/90 px-1.5 py-0.5 text-[11px] font-medium text-inverse-foreground shadow-sm">
              {hotspot.label || `Точка ${hotspot.hotspotNumber}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
