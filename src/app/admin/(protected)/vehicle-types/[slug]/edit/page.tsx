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
  return { title: `Редактировать тип техники «${slug}» — Админка AYPROM` };
}

export default async function EditVehicleTypePage({ params }: EditVehicleTypePageProps) {
  const { slug } = await params;
  const vehicleType = await getAdminVehicleType(slug);

  if (!vehicleType) {
    notFound();
  }

  return <VehicleTypeForm mode="edit" vehicleType={vehicleType} />;
}
