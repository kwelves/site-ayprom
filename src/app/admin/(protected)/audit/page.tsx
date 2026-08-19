import type { Metadata } from "next";
import { getAuditLog, getAuditLogEntityTypes } from "@/lib/admin/queries";
import { parseAdminPage } from "@/lib/admin/pagination";
import { auditActionLabel, auditEntityLabel } from "@/lib/admin/audit-labels";
import { AdminPagination } from "@/components/admin/AdminPagination";
import { AuditFilterBar } from "@/components/admin/AuditFilterBar";
import { AuditDiffDetail } from "@/components/admin/AuditDiffDetail";
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Журнал изменений</h1>
      </div>

      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Записи создаются автоматически на уровне базы данных при любом изменении каталога.
        Журнал доступен только для чтения — записи нельзя изменить или удалить через админку.
      </p>

      <AuditFilterBar entityTypes={entityTypes.map((slug) => ({ slug, name: auditEntityLabel(slug) }))} />

      {log.total > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {isFiltered ? "Найдено" : "Всего"}: {log.total}
          {log.totalPages > 1 && ` · страница ${log.page} из ${log.totalPages}`}
        </p>
      )}

      {log.items.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          {isFiltered ? "Ничего не найдено." : "Изменений пока нет."}
        </p>
      ) : (
        <>
          {/* Таблица — от sm и шире, где строка с полным дифом умещается без
              горизонтальной прокрутки. Ниже — карточный список: та же диагональная
              прокрутка ради одной длинной ячейки "Что изменилось" на телефоне не
              стоит того, а карточка читается вертикально естественно. */}
          <div className="mt-6 hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">Когда</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Действие</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Раздел</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Запись</th>
                  <th scope="col" className="py-2 font-medium">Что изменилось</th>
                </tr>
              </thead>
              <tbody>
                {log.items.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/60 align-top">
                    <td className="whitespace-nowrap py-2.5 pr-4 text-muted-foreground">
                      {DATE_FORMAT.format(new Date(entry.occurredAt))}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span
                        className={cn(
                          "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
                          ACTION_STYLES[entry.action] ?? "bg-muted text-muted-foreground"
                        )}
                      >
                        {auditActionLabel(entry.action)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-card-foreground">{auditEntityLabel(entry.entityType)}</td>
                    <td className="max-w-[16rem] break-words py-2.5 pr-4 font-mono text-xs text-muted-foreground">
                      {entry.entityKey ?? "—"}
                    </td>
                    <td className="max-w-[20rem] break-words py-2.5 text-muted-foreground">
                      <AuditDiffDetail entry={entry} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex flex-col gap-2 sm:hidden">
            {log.items.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-border bg-card p-3">
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
                {entry.entityKey && <p className="mt-0.5 break-words font-mono text-xs text-muted-foreground">{entry.entityKey}</p>}
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
