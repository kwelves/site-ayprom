import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { CategoryCard } from "@/components/home/CategoryCard";
import { getBrand } from "@/lib/queries/brands";
import { getCategory } from "@/lib/queries/categories";
import { getBrandSubcategories } from "@/lib/queries/subcategories";
import { getCategoryGridSizing } from "@/lib/category-grid";
import { cn } from "@/lib/utils";

export const revalidate = 0;

interface BrandCategoryPageProps {
  params: Promise<{ slug: string; categorySlug: string }>;
}

export async function generateMetadata({ params }: BrandCategoryPageProps): Promise<Metadata> {
  const { slug, categorySlug } = await params;
  const [brand, category] = await Promise.all([getBrand(slug), getCategory(categorySlug)]);
  return { title: brand && category ? `${category.name} — ${brand.name} — AYPROM` : "Каталог — AYPROM" };
}

export default async function BrandCategoryPage({ params }: BrandCategoryPageProps) {
  const { slug, categorySlug } = await params;
  const [brand, category] = await Promise.all([getBrand(slug), getCategory(categorySlug)]);

  // Brand-type categories never link here — /catalog/brand/[slug] sends
  // them straight to the existing /catalog/category/[slug]/brand/[brandSlug]
  // route instead, since that already covers "this category, this brand".
  if (!brand || !category || category.type !== "subcategory") {
    notFound();
  }

  const subcategories = await getBrandSubcategories(slug, categorySlug);

  if (subcategories.length === 0) {
    return (
      <Reveal>
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">{brand.name}</p>
          <h1 className="mt-3 text-2xl font-bold text-foreground sm:text-3xl">{category.name}</h1>
          <p className="mt-3 text-slate-600">
            У бренда «{brand.name}» пока нет товаров в категории «{category.name}».
          </p>
        </div>
      </Reveal>
    );
  }

  const sizing = getCategoryGridSizing(subcategories.length);

  return (
    <>
      <Reveal>
        <SectionHeading
          className="mx-auto max-w-2xl text-center"
          eyebrow={brand.name}
          title={category.name}
          description="Выберите подкатегорию, чтобы быстро найти нужные детали."
        />
      </Reveal>
      <StaggerGroup
        className={cn("mt-10 flex flex-wrap justify-center gap-4 sm:gap-6 lg:gap-8", sizing.containerClassName)}
      >
        {subcategories.map((sub) => (
          <StaggerItem key={sub.slug} className={sizing.itemClassName}>
            <CategoryCard
              href={`/catalog/brand/${slug}/category/${categorySlug}/subcategory/${sub.slug}`}
              image={sub.image}
              name={sub.name}
              sizes="(max-width: 1023px) 30vw, 380px"
              imageClassName={sizing.imageClassName}
              nameClassName={sizing.nameClassName}
            />
          </StaggerItem>
        ))}
      </StaggerGroup>
    </>
  );
}
