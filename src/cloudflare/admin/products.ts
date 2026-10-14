import { ADMIN_PAGE_SIZE } from "@/lib/admin/pagination";

export interface AdminReadProduct { id: string; slug: string; name: string; article: string | null; published: boolean }
export interface AdminReadQuery { q: string; page: number }
export interface AdminReadPage { items: AdminReadProduct[]; page: number; pageSize: number; total: number; totalPages: number }
export type AdminProductReader = (query: AdminReadQuery) => Promise<AdminReadPage>;

export function parseAdminReadQuery(params: URLSearchParams): AdminReadQuery {
  const rawPage = params.get("page") ?? "1";
  const q = (params.get("q") ?? "").trim();
  if (params.getAll("page").length > 1 || params.getAll("q").length > 1
    || !/^[1-9]\d{0,5}$/.test(rawPage) || Number(rawPage) > 100_000 || q.length > 200) throw new Error("invalid_query");
  return { q, page: Number(rawPage) };
}

export function adminReadPage(items: AdminReadProduct[], total: number, page: number): AdminReadPage {
  return { items, total, page, pageSize: ADMIN_PAGE_SIZE, totalPages: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)) };
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function renderAdminProducts(result: AdminReadPage, query: AdminReadQuery): string {
  const link = (page: number, label: string) => `<a href="/admin/products?${escape(new URLSearchParams({ q: query.q, page: String(page) }).toString())}">${label}</a>`;
  const rows = result.items.map((item) => `<tr><td>${escape(item.name)}</td><td>${escape(item.article ?? "—")}</td><td>${item.published ? "Опубликован" : "Черновик"}</td><td><a href="/admin/products/${encodeURIComponent(item.slug)}/edit">Открыть</a></td></tr>`).join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Товары — AYPROM</title></head><body><main>
<h1>Товары</h1><p>Локальный просмотр. Изменение данных недоступно.</p><a href="/admin">Главная админки</a>
<form method="get" action="/admin/products"><label>Поиск <input name="q" maxlength="200" value="${escape(query.q)}"></label><button type="submit">Найти</button></form>
<p>Всего: ${result.total}. Страница ${result.page} из ${result.totalPages}.</p>
${rows ? `<table><thead><tr><th>Название</th><th>Артикул</th><th>Публикация</th><th>Действие</th></tr></thead><tbody>${rows}</tbody></table>` : "<p>Товары не найдены.</p>"}
<nav aria-label="Страницы">${result.page > 1 ? link(result.page - 1, "Назад") : ""} ${result.page < result.totalPages ? link(result.page + 1, "Вперёд") : ""}</nav>
<form method="post" action="/api/admin/logout"><button type="submit">Выйти</button></form></main></body></html>`;
}
