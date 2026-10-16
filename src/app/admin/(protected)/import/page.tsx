import type { Metadata } from "next";
import { ImportProducts } from "@/components/admin/ImportProducts";

export const metadata: Metadata = {
  title: "Импорт товаров — Админка AYPROM",
};

export default function AdminImportPage() {
  return (
    <div>
      <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-balance text-foreground sm:text-[26px]">Импорт товаров</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Загрузите CSV-файл — сначала покажем предпросмотр с построчными ошибками, запись в базу произойдёт
        только после подтверждения. Товар с указанным артикулом, который уже есть в каталоге, будет обновлён;
        товар без совпадения по артикулу — создан заново.
      </p>
      <ImportProducts />
    </div>
  );
}
