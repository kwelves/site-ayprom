import Link from "next/link";
import type { Metadata } from "next";
import { VehicleHotspotPreview } from "@/components/admin/VehicleHotspotPreview";
import { VehicleShowcaseEditor } from "@/components/admin/VehicleShowcaseEditor";
import { getAdminVehicleHotspots, getAdminVehicleTypes } from "@/lib/admin/queries";

export const metadata: Metadata = {
  title: "Спецтехника — Админка AYPROM",
};

export const revalidate = 0;

interface AdminVehicleShowcasePageProps {
  searchParams: Promise<{ vehicle?: string }>;
}

export default async function AdminVehicleShowcasePage({ searchParams }: AdminVehicleShowcasePageProps) {
  const [{ vehicle }, vehicleTypes] = await Promise.all([searchParams, getAdminVehicleTypes()]);
  const selectedVehicle = vehicleTypes.find((vehicleType) => vehicleType.slug === vehicle) ?? vehicleTypes[0] ?? null;

  if (!selectedVehicle) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-foreground">Спецтехника</h1>
        <p className="mt-4 text-sm text-muted-foreground">Сначала добавьте тип техники, чтобы настроить хотспоты.</p>
      </div>
    );
  }

  const hotspots = await getAdminVehicleHotspots(selectedVehicle.slug);

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-foreground">Спецтехника</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Изменяйте подписи и закреплённые товары. Положение и нумерация точек остаются прежними — фото ниже показывает,
        где они сейчас находятся.
      </p>

      <nav aria-label="Выбор типа техники" className="mt-6 flex flex-wrap gap-2">
        {vehicleTypes.map((vehicleType) => {
          const active = vehicleType.slug === selectedVehicle.slug;
          return (
            <Link
              key={vehicleType.slug}
              href={`/admin/vehicle-showcase?vehicle=${encodeURIComponent(vehicleType.slug)}`}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                  : "rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-border-interactive hover:bg-accent hover:text-foreground"
              }
            >
              {vehicleType.name}
            </Link>
          );
        })}
      </nav>

      {hotspots.length === 0 ? (
        <div className="mt-6 rounded-lg border border-border bg-card p-4">
          <h2 className="text-base font-semibold text-card-foreground">{selectedVehicle.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Для этого типа техники хотспоты ещё не настроены. Здесь нельзя создавать или перемещать точки.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6">
            <VehicleHotspotPreview vehicleTypeSlug={selectedVehicle.slug} hotspots={hotspots} />
          </div>
          <VehicleShowcaseEditor
            key={selectedVehicle.slug}
            vehicleTypeSlug={selectedVehicle.slug}
            vehicleTypeName={selectedVehicle.name}
            hotspots={hotspots}
          />
        </>
      )}
    </div>
  );
}
