import Link from "next/link";
import type { Metadata } from "next";
import { getAdminVehicleTypes } from "@/lib/admin/queries";
import { VehicleTypesList } from "@/components/admin/VehicleTypesList";

export const metadata: Metadata = {
  title: "Типы техники — Админка AYPROM",
};

export const revalidate = 0;

interface AdminVehicleTypesPageProps {
  searchParams: Promise<{ created?: string; updated?: string }>;
}

export default async function AdminVehicleTypesPage({ searchParams }: AdminVehicleTypesPageProps) {
  const { created, updated } = await searchParams;
  const vehicleTypes = await getAdminVehicleTypes();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Типы техники</h1>
        <Link
          href="/admin/vehicle-types/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-blue-700"
        >
          Добавить тип техники
        </Link>
      </div>

      {vehicleTypes.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">Типов техники пока нет.</p>
      ) : (
        <VehicleTypesList
          vehicleTypes={vehicleTypes}
          flashSlug={created ?? updated}
          flashAction={created ? "created" : updated ? "updated" : undefined}
        />
      )}
    </div>
  );
}
