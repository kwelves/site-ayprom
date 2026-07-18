import type { Metadata } from "next";
import { BrandForm } from "@/components/admin/BrandForm";

export const metadata: Metadata = {
  title: "Новый бренд — Админка AYPROM",
};

export default function NewBrandPage() {
  return <BrandForm mode="create" />;
}
