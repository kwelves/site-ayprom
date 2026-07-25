"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/ErrorState";

export default function AdminError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Admin route error", error);
  }, [error]);

  return (
    <ErrorState
      title="Операция админки не выполнена"
      description="Данные не были подтверждены. Повторите загрузку страницы; если ошибка сохранится, проверьте Supabase."
      retry={unstable_retry}
      homeHref="/admin/products"
    />
  );
}
