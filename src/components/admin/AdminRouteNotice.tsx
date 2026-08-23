"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAdminToast } from "@/components/admin/ui/AdminToastProvider";

const NOTICE_MESSAGES: Record<string, string> = {
  "product-deleted": "Товар успешно удалён",
  "brand-deleted": "Бренд успешно удалён",
  "category-deleted": "Категория успешно удалена",
  "subcategory-deleted": "Подкатегория успешно удалена",
  "vehicle-type-deleted": "Тип техники успешно удалён",
};

export function AdminRouteNotice() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { success } = useAdminToast();
  const notice = searchParams.get("notice");

  useEffect(() => {
    const message = notice ? NOTICE_MESSAGES[notice] : undefined;
    if (!message) return;

    success(message);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("notice");
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [notice, pathname, router, searchParams, success]);

  return null;
}
