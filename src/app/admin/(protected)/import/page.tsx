import type { Metadata } from "next";
import { ImportProducts } from "@/components/admin/ImportProducts";
import { AdminPageHeader } from "@/components/admin/ui/AdminPageHeader";

export const metadata: Metadata = {
  title: "Импорт товаров — Админка AYPROM",
};

export default function AdminImportPage() {
  return (
    <div>
      <AdminPageHeader
        title="Импорт товаров"
        description="Загрузите CSV-файл, проверьте список и подтвердите. Товар с уже известным артикулом обновится, остальные создадутся."
      />
      <ImportProducts />
    </div>
  );
}
