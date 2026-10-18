"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/admin/ui/Select";
import { AUDIT_ACTION_LABELS } from "@/lib/admin/audit-labels";

interface AuditFilterBarProps {
  entityTypes: { slug: string; name: string }[];
  /** "Всего: 12 · страница 1 из 2", shown on the right of the bar. */
  summary?: string;
}

// The same glass filter bar as on the products list: the two filters on the left, the count on the right.
export function AuditFilterBar({ entityTypes, summary }: AuditFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // Параметры собираются заново, а не правятся поверх текущих: смена фильтра
  // должна сбрасывать номер страницы, иначе можно остаться на десятой
  // странице выборки, в которой всего две.
  function navigate(nextEntity: string, nextAction: string) {
    const params = new URLSearchParams();
    if (nextEntity) params.set("entity", nextEntity);
    if (nextAction) params.set("action", nextAction);
    const query = params.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  }

  const entity = searchParams.get("entity") ?? "";
  const action = searchParams.get("action") ?? "";

  return (
    <div className="glass-panel mt-5 flex flex-col gap-3 rounded-[18px] p-3 sm:flex-row sm:items-center">
      {summary && <p className="order-last text-xs text-muted-foreground tabular-nums sm:ml-auto sm:pr-2">{summary}</p>}
      <Select
        name="entity"
        aria-label="Фильтр по разделу"
        value={entity}
        onChange={(e) => navigate(e.target.value, action)}
        className="sm:max-w-xs"
      >
        <option value="">Все разделы</option>
        {entityTypes.map((item) => (
          <option key={item.slug} value={item.slug}>
            {item.name}
          </option>
        ))}
      </Select>
      <Select
        name="action"
        aria-label="Фильтр по действию"
        value={action}
        onChange={(e) => navigate(entity, e.target.value)}
        className="sm:max-w-xs"
      >
        <option value="">Все действия</option>
        {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
    </div>
  );
}
