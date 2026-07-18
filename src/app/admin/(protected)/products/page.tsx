import Link from "next/link";
import type { Metadata } from "next";
import { getAdminProducts } from "@/lib/admin/queries";
import { ProductsList } from "@/components/admin/ProductsList";

export const metadata: Metadata = {
  title: "Товары — Админка AYPROM",
};

export const revalidate = 0;

export default async function AdminProductsPage() {
  const products = await getAdminProducts();

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

      {products.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">Товаров пока нет.</p>
      ) : (
        <ProductsList products={products} />
      )}
    </div>
  );
}
