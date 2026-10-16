import Link from "next/link";
import type { Metadata } from "next";
import { getAdminVehicleTypes } from "@/lib/admin/queries";
import { VehicleTypesList } from "@/components/admin/VehicleTypesList";
import { EmptyState } from "@/components/ui/EmptyState";
import { buttonClassName } from "@/components/admin/ui/button-styles";

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
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-balance text-foreground sm:text-[26px]">Типы техники</h1>
        <Link
          href="/admin/vehicle-types/new"
          className={buttonClassName({ variant: "primary" })}
        >
          Добавить тип техники
        </Link>
      </div>

      {vehicleTypes.length === 0 ? (
        <EmptyState
          title="Типов техники пока нет"
          description="Добавьте первый тип спецтехники, чтобы привязывать к нему товары."
          actionHref="/admin/vehicle-types/new"
          actionLabel="Добавить тип техники"
        />
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
