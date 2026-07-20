import { createClient } from "@/lib/supabase/server";
import type { VehicleType } from "@/types/catalog";

interface VehicleTypeRow {
  slug: string;
  name: string;
}

function mapVehicleType(row: VehicleTypeRow): VehicleType {
  return {
    slug: row.slug,
    name: row.name,
  };
}

export async function getVehicleTypes(): Promise<VehicleType[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("vehicle_types").select("slug, name").order("order");
  if (error) throw error;
  return (data as VehicleTypeRow[]).map(mapVehicleType);
}
