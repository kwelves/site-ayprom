import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  getAdminProducts,
  getAdminCategories,
  getAdminProductHotspotOptions,
} from "@/lib/admin/queries";
import { parseAdminPage } from "@/lib/admin/pagination";
import {
  ADMIN_PRODUCT_LIST_CONFIG_COOKIE,
  normalizeAdminProductListCategory,
  parseAdminProductListConfigCookie,
  resolveAdminProductListConfig,
} from "@/lib/admin/product-list-config";
import { ProductsList } from "@/components/admin/ProductsList";
import { ProductsFilterBar } from "@/components/admin/ProductsFilterBar";
import { AdminPagination } from "@/components/admin/AdminPagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProductFiltersResetButton } from "@/components/admin/ProductFiltersResetButton";

export const metadata: Metadata = {
  title: "Товары — Админка AYPROM",
};

export const revalidate = 0;

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
    view?: string;
    relaxed?: string;
  }>;
}

export default async function AdminProductsPage({ searchParams }: AdminProductsPageProps) {
  const { q, category, sort, status, availability, page, created, updated, photoError, view, relaxed } = await searchParams;
  const photoErrorCount = Number(photoError);
  const currentPage = parseAdminPage(page);

  const [categories, cookieStore] = await Promise.all([getAdminCategories(), cookies()]);
  const parsedSavedConfig = parseAdminProductListConfigCookie(
    cookieStore.get(ADMIN_PRODUCT_LIST_CONFIG_COOKIE)?.value,
  );
  const validCategorySlugs = new Set(categories.map((item) => item.slug));
  const savedConfig = parsedSavedConfig
    ? normalizeAdminProductListCategory(parsedSavedConfig, validCategorySlugs)
    : null;
  const resolvedView = resolveAdminProductListConfig(
    { view, category, status, availability, sort },
    savedConfig,
  );
  const config = normalizeAdminProductListCategory(resolvedView.config, validCategorySlugs);
  const resolvedPublished = config.status === "published" ? true : config.status === "draft" ? false : undefined;
  const isFiltered = Boolean(q?.trim() || config.category || resolvedPublished !== undefined || config.availability);

  const [productPage, hotspotOptions] = await Promise.all([
    getAdminProducts({
      q,
      categorySlug: config.category || undefined,
      sort: config.sort,
      published: resolvedPublished,
      availability: config.availability || undefined,
      page: currentPage,
    }),
    getAdminProductHotspotOptions(),
  ]);
  const relaxedFields = relaxed?.split(",").filter(Boolean) ?? [];
  const showTargetViewNotice = resolvedView.view === "target" && savedConfig !== null && relaxedFields.length > 0;
  const savedViewHref = q?.trim()
    ? `/admin/products?q=${encodeURIComponent(q.trim())}`
    : "/admin/products";
  const photoWarning =
    Number.isInteger(photoErrorCount) && photoErrorCount > 0
      ? `${photoErrorCount === 1 ? "Одну фотографию" : `${photoErrorCount} фотографий`} не удалось загрузить. Добавьте ${photoErrorCount === 1 ? "её" : "их"} через редактирование товара.`
      : undefined;

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

      <ProductsFilterBar
        key={`${config.category}:${config.status}:${config.availability}:${config.sort}:${savedConfig !== null}`}
        categories={categories.map((c) => ({ slug: c.slug, name: c.name }))}
        initialConfig={config}
        initialSaved={savedConfig !== null}
      />

      {showTargetViewNotice && (
        <div className="mt-3 flex flex-col gap-2 rounded-md bg-warning-surface px-3 py-2 text-sm text-warning sm:flex-row sm:items-center sm:justify-between">
          <p>Некоторые сохранённые фильтры временно сняты, чтобы показать изменённый товар.</p>
          <Link href={savedViewHref} className="inline-flex min-h-11 items-center font-medium underline underline-offset-2 sm:min-h-0">
            Вернуть сохранённую конфигурацию
          </Link>
        </div>
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
          action={isFiltered ? <ProductFiltersResetButton /> : undefined}
          actionHref={isFiltered ? undefined : "/admin/products/new"}
          actionLabel={isFiltered ? undefined : "Добавить товар"}
        />
      ) : (
        <>
          {/* Перетаскивание остаётся доступным и в отфильтрованном, и в
              постраничном виде: reorder_products переставляет товары внутри
              уже занятых ими значений order, а не нумерует подряд от нуля,
              поэтому позиции товаров вне текущей выборки не сдвигаются. */}
          <ProductsList
            key={`${q ?? ""}:${config.category}:${config.status}:${config.availability}:${config.sort}:${productPage.page}`}
            products={productPage.items}
            hotspotOptions={hotspotOptions}
            reorderDisabled={config.sort !== "order"}
            flashSlug={created ?? updated}
            flashAction={created ? "created" : updated ? "updated" : undefined}
            flashWarning={photoWarning}
          />
          <AdminPagination page={productPage.page} totalPages={productPage.totalPages} />
        </>
      )}
    </div>
  );
}
