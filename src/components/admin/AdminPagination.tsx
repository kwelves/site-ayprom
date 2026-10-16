"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface AdminPaginationProps {
  page: number;
  totalPages: number;
}

// Ссылки, а не кнопки: страница остаётся в URL, поэтому её можно открыть в
// новой вкладке, сохранить в закладку и вернуться на неё после сохранения
// товара. Фильтры из строки запроса переносятся как есть.
export function AdminPagination({ page, totalPages }: AdminPaginationProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (totalPages <= 1) return null;

  function hrefForPage(target: number) {
    const params = new URLSearchParams(searchParams.toString());
    // Первая страница пишется без параметра — так у списка один канонический
    // адрес вместо двух, ведущих на одно и то же.
    if (target <= 1) params.delete("page");
    else params.set("page", String(target));
    // Флеш-подсветка относится к конкретному сохранению, а не к странице.
    params.delete("created");
    params.delete("updated");
    params.delete("photoError");
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  const linkClass =
    "glass-plate inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-[10px] px-3 text-[13px] font-semibold text-foreground transition-[background-color,scale] duration-fast ease-ui hover:bg-secondary active:scale-[0.97] sm:h-9.5 sm:min-w-9.5";
  const disabledClass = "pointer-events-none opacity-40";

  return (
    <nav aria-label="Навигация по страницам" className="mt-6 flex items-center justify-between gap-3">
      <Link
        href={hrefForPage(page - 1)}
        aria-label="Предыдущая страница"
        aria-disabled={page <= 1}
        tabIndex={page <= 1 ? -1 : undefined}
        className={cn(linkClass, page <= 1 && disabledClass)}
      >
        <ChevronLeft className="h-4 w-4" />
        Назад
      </Link>

      <span aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
        {page} / {totalPages}
      </span>

      <Link
        href={hrefForPage(page + 1)}
        aria-label="Следующая страница"
        aria-disabled={page >= totalPages}
        tabIndex={page >= totalPages ? -1 : undefined}
        className={cn(linkClass, page >= totalPages && disabledClass)}
      >
        Вперёд
        <ChevronRight className="h-4 w-4" />
      </Link>
    </nav>
  );
}
