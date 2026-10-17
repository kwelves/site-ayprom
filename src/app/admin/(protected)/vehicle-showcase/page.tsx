import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/ui/AdminPageHeader";
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
        <AdminPageHeader title="Спецтехника" description="Сначала добавьте тип техники, чтобы настроить точки." />
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        title="Спецтехника"
        description="Подписи точек и закреплённые за ними товары для главной страницы. Положение точек не меняется, фото справа показывает, где они стоят."
      />

      <VehicleShowcaseTabs
        vehicleTypes={vehicleTypes}
        hotspots={hotspots}
        initialVehicleTypeSlug={selectedVehicle.slug}
      />
    </div>
  );
}
