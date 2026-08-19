import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAdminCategory, getAdminCategoryBrands, getAdminBrands } from "@/lib/admin/queries";
import { CategoryBrandsManager } from "@/components/admin/CategoryBrandsManager";
import { Breadcrumbs } from "@/components/admin/ui/Breadcrumbs";

export const revalidate = 0;

interface CategoryBrandsPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: CategoryBrandsPageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Бренды категории «${slug}» — Админка AYPROM` };
}

export default async function CategoryBrandsPage({ params }: CategoryBrandsPageProps) {
  const { slug } = await params;
  const [category, attachedBrands, allBrands] = await Promise.all([
    getAdminCategory(slug),
    getAdminCategoryBrands(slug),
    getAdminBrands(),
  ]);
  if (!category) {
    notFound();
  }

  return (
    <div className="max-w-2xl">
      <Breadcrumbs
        items={[
          { label: "Категории", href: "/admin/categories" },
          { label: category.name, href: `/admin/categories/${slug}/edit` },
          { label: "Бренды" },
        ]}
      />

      <h1 className="mt-4 text-xl font-semibold text-foreground">Бренды категории: {category.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Какие бренды показывать на странице этой категории, в каком порядке, и с каким масштабом логотипа (если
        отличается от общего значения бренда).
      </p>

      <div className="mt-6">
        <CategoryBrandsManager categorySlug={slug} initialAttached={attachedBrands} allBrands={allBrands} />
      </div>
    </div>
  );
}
