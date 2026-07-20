import Link from "next/link";
import type { Metadata } from "next";
import { getAdminBrands } from "@/lib/admin/queries";
import { BrandsList } from "@/components/admin/BrandsList";

export const metadata: Metadata = {
  title: "Бренды — Админка AYPROM",
};

export const revalidate = 0;

interface AdminBrandsPageProps {
  searchParams: Promise<{ created?: string; updated?: string }>;
}

export default async function AdminBrandsPage({ searchParams }: AdminBrandsPageProps) {
  const { created, updated } = await searchParams;
  const brands = await getAdminBrands();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Бренды</h1>
        <Link
          href="/admin/brands/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-blue-700"
        >
          Добавить бренд
        </Link>
      </div>

      {brands.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">Брендов пока нет.</p>
      ) : (
        <BrandsList
          brands={brands}
          flashSlug={created ?? updated}
          flashAction={created ? "created" : updated ? "updated" : undefined}
        />
      )}
    </div>
  );
}
