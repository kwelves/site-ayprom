import Link from "next/link";
import type { Metadata } from "next";
import { getAdminProducts, getAdminCategories } from "@/lib/admin/queries";
import { parseAdminPage } from "@/lib/admin/pagination";
import { ProductsList } from "@/components/admin/ProductsList";
import { ProductsFilterBar } from "@/components/admin/ProductsFilterBar";
import { AdminPagination } from "@/components/admin/AdminPagination";

export const metadata: Metadata = {
  title: "Товары — Админка AYPROM",
};

export const revalidate = 0;

interface AdminProductsPageProps {
  searchParams: Promise<{ q?: string; category?: string; page?: string; created?: string; updated?: string }>;
}

export default async function AdminProductsPage({ searchParams }: AdminProductsPageProps) {
  const { q, category, page, created, updated } = await searchParams;
  const isFiltered = Boolean(q?.trim() || category);
  const currentPage = parseAdminPage(page);

  const [productPage, categories] = await Promise.all([
    getAdminProducts({ q, categorySlug: category, page: currentPage }),
    getAdminCategories(),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Товары</h1>
        <Link
          href="/admin/products/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-blue-700"
        >
          Добавить товар
        </Link>
      </div>

      <ProductsFilterBar categories={categories.map((c) => ({ slug: c.slug, name: c.name }))} />

      {productPage.total > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {isFiltered ? "Найдено" : "Всего"}: {productPage.total}
          {productPage.totalPages > 1 && ` · страница ${productPage.page} из ${productPage.totalPages}`}
        </p>
      )}

      {productPage.items.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          {isFiltered ? "Ничего не найдено." : "Товаров пока нет."}
        </p>
      ) : (
        <>
          {/* Перетаскивание остаётся доступным и в отфильтрованном, и в
              постраничном виде: reorder_products переставляет товары внутри
              уже занятых ими значений order, а не нумерует подряд от нуля,
              поэтому позиции товаров вне текущей выборки не сдвигаются. */}
          <ProductsList
            key={`${q ?? ""}:${category ?? ""}:${productPage.page}`}
            products={productPage.items}
            flashSlug={created ?? updated}
            flashAction={created ? "created" : updated ? "updated" : undefined}
          />
          <AdminPagination page={productPage.page} totalPages={productPage.totalPages} />
        </>
      )}
    </div>
  );
}
