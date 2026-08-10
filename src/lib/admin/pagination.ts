// Отдельно от queries.ts по той же причине, что и usage-descriptions.ts: тот
// модуль начинается с `import "server-only"` и тянет за собой service-role
// клиент. Разбор номера страницы нужен и странице, и тестам, поэтому живёт
// там, где его можно импортировать без этого груза.

export const ADMIN_PAGE_SIZE = 50;

// Номер страницы приходит из строки запроса, то есть от пользователя. Всё, что
// не является положительным целым — ноль, минус, дробь, буквы, пустая строка —
// сводится к первой странице: иначе отрицательный сдвиг ушёл бы в range() и
// запрос упал бы вместо показа списка.
export function parseAdminPage(value?: string): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}
