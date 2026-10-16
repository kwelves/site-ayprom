import Link from "next/link";
import type { Metadata } from "next";
import { getAdminCategories } from "@/lib/admin/queries";
import { CategoriesList } from "@/components/admin/CategoriesList";
import { EmptyState } from "@/components/ui/EmptyState";
import { buttonClassName } from "@/components/admin/ui/button-styles";

export const metadata: Metadata = {
  title: "Категории — Админка AYPROM",
};

export const revalidate = 0;

interface AdminCategoriesPageProps {
  searchParams: Promise<{ created?: string; updated?: string }>;
}

export default async function AdminCategoriesPage({ searchParams }: AdminCategoriesPageProps) {
  const { created, updated } = await searchParams;
  const categories = await getAdminCategories();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-balance text-foreground sm:text-[26px]">Категории</h1>
        <Link
          href="/admin/categories/new"
          className={buttonClassName({ variant: "primary" })}
        >
          Добавить категорию
        </Link>
      </div>

      {categories.length === 0 ? (
        <EmptyState
          title="Категорий пока нет"
          description="Создайте первую категорию, чтобы начать наполнять каталог."
          actionHref="/admin/categories/new"
          actionLabel="Добавить категорию"
        />
      ) : (
        <CategoriesList
          categories={categories}
          flashSlug={created ?? updated}
          flashAction={created ? "created" : updated ? "updated" : undefined}
        />
      )}
    </div>
  );
}
