"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/admin/ui/Select";
import { AUDIT_ACTION_LABELS } from "@/lib/admin/audit-labels";

interface AuditFilterBarProps {
  entityTypes: { slug: string; name: string }[];
}

export function AuditFilterBar({ entityTypes }: AuditFilterBarProps) {
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
    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
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
