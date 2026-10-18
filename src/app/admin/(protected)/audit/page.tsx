import type { Metadata } from "next";
import { getAuditLog, getAuditLogEntityTypes } from "@/lib/admin/queries";
import { parseAdminPage } from "@/lib/admin/pagination";
import { auditActionLabel, auditEntityLabel } from "@/lib/admin/audit-labels";
import { AdminPagination } from "@/components/admin/AdminPagination";
import { AuditFilterBar } from "@/components/admin/AuditFilterBar";
import { AuditDiffDetail } from "@/components/admin/AuditDiffDetail";
import { EmptyState } from "@/components/ui/EmptyState";
import { AdminPageHeader } from "@/components/admin/ui/AdminPageHeader";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Журнал изменений — Админка AYPROM",
};

export const revalidate = 0;

interface AuditPageProps {
  searchParams: Promise<{ entity?: string; action?: string; page?: string }>;
}

const ACTION_STYLES: Record<string, string> = {
  INSERT: "bg-success-surface text-success",
  UPDATE: "bg-accent-strong text-accent-foreground",
  DELETE: "bg-danger-surface-hover text-danger",
};

// Время пишется триггером через clock_timestamp() в UTC. Показываем в
// Бишкеке — это часовой пояс клиента, и «час назад» должно читаться как час
// назад по местным часам, а не по UTC.
const DATE_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "Asia/Bishkek",
});

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const { entity, action, page } = await searchParams;
  const currentPage = parseAdminPage(page);
  const isFiltered = Boolean(entity || action);

  const [log, entityTypes] = await Promise.all([
    getAuditLog({ entityType: entity, action, page: currentPage }),
    getAuditLogEntityTypes(),
  ]);

  return (
    <div>
      <AdminPageHeader
        title="Журнал изменений"
        description="Каждое изменение каталога записывается автоматически. Записи нельзя изменить или удалить."
      />

      <AuditFilterBar
        entityTypes={entityTypes.map((slug) => ({ slug, name: auditEntityLabel(slug) }))}
        summary={
          log.total > 0
            ? `${isFiltered ? "Найдено" : "Всего"}: ${log.total}${log.totalPages > 1 ? ` · страница ${log.page} из ${log.totalPages}` : ""}`
            : undefined
        }
      />

      {log.items.length === 0 ? (
        <EmptyState
          title={isFiltered ? "Ничего не найдено" : "Изменений пока нет"}
          description={isFiltered ? "Попробуйте изменить фильтры." : "Записи появятся здесь, как только вы что-то измените в каталоге."}
          {...(isFiltered ? { actionHref: "/admin/audit", actionLabel: "Сбросить фильтры" } : {})}
        />
      ) : (
        <>
          {/* Таблица — от sm и шире, где строка с полным дифом умещается без
              горизонтальной прокрутки. Ниже — карточный список: та же диагональная
              прокрутка ради одной длинной ячейки "Что изменилось" на телефоне не
              стоит того, а карточка читается вертикально естественно. */}
          <div className="glass-panel mt-4 hidden overflow-x-auto rounded-[18px] sm:block">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-subtle text-left text-xs font-medium text-muted-foreground">
                  <th scope="col" className="py-3 pr-4 pl-5 font-medium">Когда</th>
                  <th scope="col" className="py-3 pr-4 font-medium">Действие</th>
                  <th scope="col" className="py-3 pr-4 font-medium">Раздел</th>
                  <th scope="col" className="py-3 pr-4 font-medium">Запись</th>
                  <th scope="col" className="py-3 pr-5 font-medium">Что изменилось</th>
                </tr>
              </thead>
              <tbody>
                {log.items.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/60 align-top transition-colors duration-fast ease-ui last:border-b-0 hover:bg-accent/40">
                    <td className="whitespace-nowrap py-3 pr-4 pl-5 text-muted-foreground tabular-nums">
                      {DATE_FORMAT.format(new Date(entry.occurredAt))}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={cn(
                          "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
                          ACTION_STYLES[entry.action] ?? "bg-muted text-muted-foreground"
                        )}
                      >
                        {auditActionLabel(entry.action)}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-foreground">{auditEntityLabel(entry.entityType)}</td>
                    <td className="max-w-[16rem] break-words py-3 pr-4 text-[13px] text-muted-foreground">
                      {entry.entityKey ?? "—"}
                    </td>
                    <td className="max-w-[20rem] break-words py-3 pr-5 text-muted-foreground">
                      <AuditDiffDetail entry={entry} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:hidden">
            {log.items.map((entry) => (
              <div key={entry.id} className="glass-panel rounded-[18px] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
                      ACTION_STYLES[entry.action] ?? "bg-muted text-muted-foreground"
                    )}
                  >
                    {auditActionLabel(entry.action)}
                  </span>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {DATE_FORMAT.format(new Date(entry.occurredAt))}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-card-foreground">{auditEntityLabel(entry.entityType)}</p>
                {entry.entityKey && <p className="mt-0.5 break-words text-xs text-muted-foreground">{entry.entityKey}</p>}
                <div className="mt-2 text-sm">
                  <AuditDiffDetail entry={entry} />
                </div>
              </div>
            ))}
          </div>

          <AdminPagination page={log.page} totalPages={log.totalPages} />
        </>
      )}
    </div>
  );
}
