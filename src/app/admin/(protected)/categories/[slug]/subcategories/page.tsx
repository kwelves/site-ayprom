import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAdminCategory, getAdminSubcategories } from "@/lib/admin/queries";
import { SubcategoriesList } from "@/components/admin/SubcategoriesList";
import { Breadcrumbs } from "@/components/admin/ui/Breadcrumbs";
import { EmptyState } from "@/components/ui/EmptyState";
import { buttonClassName } from "@/components/admin/ui/button-styles";

export const revalidate = 0;

interface SubcategoriesPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ created?: string; updated?: string }>;
}

export async function generateMetadata({ params }: SubcategoriesPageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Подкатегории «${slug}» — Админка AYPROM` };
}

export default async function AdminSubcategoriesPage({ params, searchParams }: SubcategoriesPageProps) {
  const { slug } = await params;
  const { created, updated } = await searchParams;
  const [category, subcategories] = await Promise.all([getAdminCategory(slug), getAdminSubcategories(slug)]);
  if (!category) {
    notFound();
  }

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Категории", href: "/admin/categories" },
          { label: category.name, href: `/admin/categories/${slug}/edit` },
          { label: "Подкатегории" },
        ]}
      />

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-balance text-foreground sm:text-[26px]">Подкатегории: {category.name}</h1>
        <Link
          href={`/admin/categories/${slug}/subcategories/new`}
          className={buttonClassName({ variant: "primary" })}
        >
          Добавить подкатегорию
        </Link>
      </div>

      {subcategories.length === 0 ? (
        <EmptyState
          title="Подкатегорий пока нет"
          description="Добавьте первую подкатегорию, чтобы распределять по ней товары."
          actionHref={`/admin/categories/${slug}/subcategories/new`}
          actionLabel="Добавить подкатегорию"
        />
      ) : (
        <SubcategoriesList
          categorySlug={slug}
          subcategories={subcategories}
          flashSlug={created ?? updated}
          flashAction={created ? "created" : updated ? "updated" : undefined}
        />
      )}
    </div>
  );
}
