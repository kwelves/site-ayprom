import Link from "next/link";
import type { Metadata } from "next";
import { getAdminBrands } from "@/lib/admin/queries";
import { BrandsList } from "@/components/admin/BrandsList";
import { EmptyState } from "@/components/ui/EmptyState";
import { buttonClassName } from "@/components/admin/ui/button-styles";

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
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-balance text-foreground sm:text-[26px]">Бренды</h1>
        <Link
          href="/admin/brands/new"
          className={buttonClassName({ variant: "primary" })}
        >
          Добавить бренд
        </Link>
      </div>

      {brands.length === 0 ? (
        <EmptyState
          title="Брендов пока нет"
          description="Добавьте первый бренд, чтобы привязывать к нему товары и категории."
          actionHref="/admin/brands/new"
          actionLabel="Добавить бренд"
        />
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
