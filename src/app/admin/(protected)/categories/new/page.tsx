import type { Metadata } from "next";
import { CategoryForm } from "@/components/admin/CategoryForm";

export const metadata: Metadata = {
  title: "Новая категория — Админка AYPROM",
};

export default function NewCategoryPage() {
  return <CategoryForm mode="create" />;
}
