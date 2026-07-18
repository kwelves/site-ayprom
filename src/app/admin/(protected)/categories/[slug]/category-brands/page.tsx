import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAdminCategory, getAdminCategoryBrands, getAdminBrands } from "@/lib/admin/queries";
import { CategoryBrandsManager } from "@/components/admin/CategoryBrandsManager";
import { BackLink } from "@/components/admin/ui/BackLink";

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
  const category = await getAdminCategory(slug);
  if (!category) {
    notFound();
  }

  const [attachedBrands, allBrands] = await Promise.all([getAdminCategoryBrands(slug), getAdminBrands()]);

  return (
    <div className="max-w-2xl">
      <BackLink href={`/admin/categories/${slug}/edit`} label={category.name} />

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
