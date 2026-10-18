import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAdminVehicleType } from "@/lib/admin/queries";
import { VehicleTypeForm } from "@/components/admin/VehicleTypeForm";

export const revalidate = 0;

interface EditVehicleTypePageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: EditVehicleTypePageProps): Promise<Metadata> {
  const { slug } = await params;
  // The record's own name, not its address: the admin keeps fetched data in memory, so the page reuses this read.
  const vehicleType = await getAdminVehicleType(slug);
  return { title: `Тип техники «${vehicleType?.name ?? slug}» — Админка AYPROM` };
}

export default async function EditVehicleTypePage({ params }: EditVehicleTypePageProps) {
  const { slug } = await params;
  const vehicleType = await getAdminVehicleType(slug);

  if (!vehicleType) {
    notFound();
  }

  return <VehicleTypeForm mode="edit" vehicleType={vehicleType} />;
}
