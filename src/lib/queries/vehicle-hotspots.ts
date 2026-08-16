import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { VehicleType } from "@/types/catalog";

export interface HotspotProduct {
  slug: string;
  name: string;
  shortDescription: string;
  images: { url: string; scale?: number }[];
}

export interface VehicleHotspot {
  id: string;
  hotspotNumber: number;
  label: string;
  xPct: number;
  yPct: number;
  product: HotspotProduct | null;
}

export interface VehicleShowcaseEntry {
  vehicleType: VehicleType;
  hotspots: VehicleHotspot[];
}

interface HotspotRow {
  id: string;
  hotspot_number: number;
  label: string;
  x_pct: string;
  y_pct: string;
  vehicle_type_slug: string;
  products: {
    slug: string;
    name: string;
    short_description: string;
    product_images: { url: string; order: number; scale: number | null }[];
  } | null;
}

function mapHotspot(row: HotspotRow): VehicleHotspot {
  const product = row.products;
  const images = product
    ? [...product.product_images]
        .sort((a, b) => a.order - b.order)
        .map((image) => ({ url: image.url, scale: image.scale ?? undefined }))
    : [];
  return {
    id: row.id,
    hotspotNumber: row.hotspot_number,
    label: row.label,
    xPct: Number(row.x_pct),
    yPct: Number(row.y_pct),
    product: product
      ? {
          slug: product.slug,
          name: product.name,
          shortDescription: product.short_description,
          images,
        }
      : null,
  };
}

// Powers the homepage "Спецтехника" showcase: every vehicle type with its
// numbered hotspots (product null = not yet linked, rendered as a "coming
// soon" placeholder card rather than hidden — see project memory on why).
// Wrapped in cache() since the section and its metadata never need this
// twice in one request, matching the convention in queries/vehicle-types.ts.
export const getVehicleShowcaseData = cache(async (): Promise<VehicleShowcaseEntry[]> => {
  const supabase = await createClient();
  const [{ data: vehicleTypes, error: vehicleTypesError }, { data: hotspotRows, error: hotspotsError }] =
    await Promise.all([
      supabase.from("vehicle_types").select("slug, name").order("order"),
      supabase
        .from("vehicle_hotspots")
        .select(
          `
            id, hotspot_number, label, x_pct, y_pct, vehicle_type_slug,
            products(slug, name, short_description, product_images(url, "order", scale))
          `,
        )
        .order("hotspot_number"),
    ]);
  if (vehicleTypesError) throw vehicleTypesError;
  if (hotspotsError) throw hotspotsError;

  const rows = hotspotRows as unknown as HotspotRow[];
  return (vehicleTypes as VehicleType[])
    .map((vehicleType) => ({
      vehicleType,
      hotspots: rows.filter((row) => row.vehicle_type_slug === vehicleType.slug).map(mapHotspot),
    }))
    .filter((entry) => entry.hotspots.length > 0);
});
