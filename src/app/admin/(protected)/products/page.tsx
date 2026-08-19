import Link from "next/link";
import type { Metadata } from "next";
import { getAdminProducts, getAdminCategories, type AdminProductSort } from "@/lib/admin/queries";
import { parseAdminPage } from "@/lib/admin/pagination";
import { isProductAvailability } from "@/lib/admin/product-availability";
import { ProductsList } from "@/components/admin/ProductsList";
import { ProductsFilterBar } from "@/components/admin/ProductsFilterBar";
import { AdminPagination } from "@/components/admin/AdminPagination";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = {
  title: "Товары — Админка AYPROM",
};

export const revalidate = 0;

const VALID_SORTS: readonly AdminProductSort[] = ["order", "name", "updated"];

interface AdminProductsPageProps {
  searchParams: Promise<{
    q?: string;
    category?: string;
    sort?: string;
    status?: string;
    availability?: string;
    page?: string;
    created?: string;
    updated?: string;
    photoError?: string;
  }>;
}

export default async function AdminProductsPage({ searchParams }: AdminProductsPageProps) {
  const { q, category, sort, status, availability, page, created, updated, photoError } = await searchParams;
  const photoErrorCount = Number(photoError);
  const resolvedSort: AdminProductSort = VALID_SORTS.includes(sort as AdminProductSort)
    ? (sort as AdminProductSort)
    : "order";
  const resolvedPublished = status === "published" ? true : status === "draft" ? false : undefined;
  const resolvedAvailability = isProductAvailability(availability) ? availability : undefined;
  const isFiltered = Boolean(q?.trim() || category || resolvedPublished !== undefined || resolvedAvailability);
  const currentPage = parseAdminPage(page);

  const [productPage, categories] = await Promise.all([
    getAdminProducts({
      q,
      categorySlug: category,
      sort: resolvedSort,
      published: resolvedPublished,
      availability: resolvedAvailability,
      page: currentPage,
    }),
    getAdminCategories(),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Товары</h1>
        <Link
          href="/admin/products/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Добавить товар
        </Link>
      </div>

      <ProductsFilterBar categories={categories.map((c) => ({ slug: c.slug, name: c.name }))} />

      {Number.isInteger(photoErrorCount) && photoErrorCount > 0 && (
        <p className="mt-3 rounded-md bg-warning-surface px-3 py-2 text-sm text-warning">
          Товар создан, но {photoErrorCount}{" "}
          {photoErrorCount === 1 ? "фотографию" : "фотографий"} не удалось загрузить. Добавьте{" "}
          {photoErrorCount === 1 ? "её" : "их"} через редактирование товара.
        </p>
      )}

      {productPage.total > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {isFiltered ? "Найдено" : "Всего"}: {productPage.total}
          {productPage.totalPages > 1 && ` · страница ${productPage.page} из ${productPage.totalPages}`}
        </p>
      )}

      {productPage.items.length === 0 ? (
        <EmptyState
          title={isFiltered ? "Ничего не найдено" : "Товаров пока нет"}
          description={isFiltered ? "Попробуйте изменить поиск или фильтры." : "Добавьте первый товар, чтобы начать наполнять каталог."}
          actionHref={isFiltered ? "/admin/products" : "/admin/products/new"}
          actionLabel={isFiltered ? "Сбросить фильтры" : "Добавить товар"}
        />
      ) : (
        <>
          {/* Перетаскивание остаётся доступным и в отфильтрованном, и в
              постраничном виде: reorder_products переставляет товары внутри
              уже занятых ими значений order, а не нумерует подряд от нуля,
              поэтому позиции товаров вне текущей выборки не сдвигаются. */}
          <ProductsList
            key={`${q ?? ""}:${category ?? ""}:${resolvedSort}:${productPage.page}`}
            products={productPage.items}
            reorderDisabled={resolvedSort !== "order"}
            flashSlug={created ?? updated}
            flashAction={created ? "created" : updated ? "updated" : undefined}
          />
          <AdminPagination page={productPage.page} totalPages={productPage.totalPages} />
        </>
      )}
    </div>
  );
}
