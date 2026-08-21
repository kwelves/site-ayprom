import type { Metadata } from "next";
import { VehicleShowcaseTabs } from "@/components/admin/VehicleShowcaseTabs";
import { getAdminVehicleHotspots, getAdminVehicleTypes } from "@/lib/admin/queries";

export const metadata: Metadata = {
  title: "Спецтехника — Админка AYPROM",
};

export const revalidate = 0;

interface AdminVehicleShowcasePageProps {
  searchParams: Promise<{ vehicle?: string }>;
}

export default async function AdminVehicleShowcasePage({ searchParams }: AdminVehicleShowcasePageProps) {
  // Five lightweight hotspot rows per vehicle are cheaper to fetch once than
  // paying a new RSC navigation + repeated vehicle-type query for every tab.
  const [{ vehicle }, vehicleTypes, hotspots] = await Promise.all([
    searchParams,
    getAdminVehicleTypes(),
    getAdminVehicleHotspots(),
  ]);
  const selectedVehicle = vehicleTypes.find((vehicleType) => vehicleType.slug === vehicle) ?? vehicleTypes[0] ?? null;

  if (!selectedVehicle) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-foreground">Спецтехника</h1>
        <p className="mt-4 text-sm text-muted-foreground">Сначала добавьте тип техники, чтобы настроить хотспоты.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-foreground">Спецтехника</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Изменяйте подписи и закреплённые товары. Положение и нумерация точек остаются прежними — фото ниже показывает,
        где они сейчас находятся.
      </p>

      <VehicleShowcaseTabs
        vehicleTypes={vehicleTypes}
        hotspots={hotspots}
        initialVehicleTypeSlug={selectedVehicle.slug}
      />
    </div>
  );
}
