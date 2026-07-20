import type { Metadata } from "next";
import { VehicleTypeForm } from "@/components/admin/VehicleTypeForm";

export const metadata: Metadata = {
  title: "Новый тип техники — Админка AYPROM",
};

export default function NewVehicleTypePage() {
  return <VehicleTypeForm mode="create" />;
}
