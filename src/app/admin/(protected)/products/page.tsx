import Link from "next/link";
import type { Metadata } from "next";
import { getAdminProducts, getAdminCategories } from "@/lib/admin/queries";
import { ProductsList } from "@/components/admin/ProductsList";
import { ProductsFilterBar } from "@/components/admin/ProductsFilterBar";

export const metadata: Metadata = {
  title: "Товары — Админка AYPROM",
};

export const revalidate = 0;

interface AdminProductsPageProps {
  searchParams: Promise<{ q?: string; category?: string; created?: string; updated?: string }>;
}

export default async function AdminProductsPage({ searchParams }: AdminProductsPageProps) {
  const { q, category, created, updated } = await searchParams;
  const isFiltered = Boolean(q?.trim() || category);

  const [products, categories] = await Promise.all([
    getAdminProducts({ q, categorySlug: category }),
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

      {isFiltered && (
        <p className="mt-3 text-xs text-muted-foreground">
          При активном поиске или фильтре перетаскивание для сортировки недоступно — измените порядок в полном списке.
        </p>
      )}

      {products.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          {isFiltered ? "Ничего не найдено." : "Товаров пока нет."}
        </p>
      ) : (
        <ProductsList
          key={`${q ?? ""}:${category ?? ""}`}
          products={products}
          sortable={!isFiltered}
          flashSlug={created ?? updated}
          flashAction={created ? "created" : updated ? "updated" : undefined}
        />
      )}
    </div>
  );
}
