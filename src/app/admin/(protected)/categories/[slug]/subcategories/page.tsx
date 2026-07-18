import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAdminCategory, getAdminSubcategories } from "@/lib/admin/queries";
import { SubcategoriesList } from "@/components/admin/SubcategoriesList";
import { BackLink } from "@/components/admin/ui/BackLink";

export const revalidate = 0;

interface SubcategoriesPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: SubcategoriesPageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Подкатегории «${slug}» — Админка AYPROM` };
}

export default async function AdminSubcategoriesPage({ params }: SubcategoriesPageProps) {
  const { slug } = await params;
  const category = await getAdminCategory(slug);
  if (!category) {
    notFound();
  }

  const subcategories = await getAdminSubcategories(slug);

  return (
    <div>
      <BackLink href={`/admin/categories/${slug}/edit`} label={category.name} />

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Подкатегории: {category.name}</h1>
        <Link
          href={`/admin/categories/${slug}/subcategories/new`}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-blue-700"
        >
          Добавить подкатегорию
        </Link>
      </div>

      {subcategories.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">Подкатегорий пока нет.</p>
      ) : (
        <SubcategoriesList categorySlug={slug} subcategories={subcategories} />
      )}
    </div>
  );
}
