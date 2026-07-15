import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { CategoryCard } from "@/components/home/CategoryCard";
import { BrandCard } from "@/components/home/BrandCard";
import { categories } from "@/data/categories";
import { subcategoriesByCategory } from "@/data/subcategories";
import { brandsByCategory, categoryCardLogoScale } from "@/data/category-brands";
import { getCategoryGridSizing } from "@/lib/category-grid";
import { cn } from "@/lib/utils";

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return categories.map((category) => ({ slug: category.slug }));
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = categories.find((item) => item.slug === slug);
  return { title: category ? `${category.name} — AYPROM` : "Каталог — AYPROM" };
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { slug } = await params;
  const category = categories.find((item) => item.slug === slug);

  if (!category) {
    notFound();
  }

  const subcategories = subcategoriesByCategory[category.slug];
  const categoryBrands = brandsByCategory[category.slug];

  if (categoryBrands) {
    // Matches CategorySection's homepage grid exactly (same columns, gap, and
    // default CategoryCard/BrandCard sizing) so brand cards are pixel-for-pixel
    // the same size as the homepage catalog cards at every breakpoint.
    return (
      <>
        <Reveal>
          <SectionHeading
            className="mx-auto max-w-2xl text-center"
            title={category.name}
            description="Выберите бренд, чтобы быстро найти нужные детали."
          />
        </Reveal>
        <StaggerGroup className="mt-10 grid grid-cols-2 gap-5 lg:grid-cols-4">
          {categoryBrands.map((brand) => (
            <StaggerItem key={brand.slug}>
              <BrandCard
                href={`/catalog/category/${category.slug}/brand/${brand.slug}`}
                brand={brand}
                logoScale={categoryCardLogoScale[brand.slug]}
              />
            </StaggerItem>
          ))}
        </StaggerGroup>
      </>
    );
  }

  if (!subcategories) {
    return (
      <Reveal>
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">Каталог</p>
          <h1 className="mt-3 text-2xl font-bold text-foreground sm:text-3xl">{category.name}</h1>
          <p className="mt-3 text-slate-600">
            Раздел в разработке. Скоро здесь появится каталог этой категории.
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
          title={category.name}
          description="Выберите подкатегорию, чтобы быстро найти нужные детали."
        />
      </Reveal>
      <StaggerGroup
        className={cn(
          "mt-10 flex flex-wrap justify-center gap-4 sm:gap-6 lg:gap-8",
          sizing.containerClassName
        )}
      >
        {subcategories.map((sub) => (
          <StaggerItem key={sub.slug} className={sizing.itemClassName}>
            <CategoryCard
              href={`/catalog/category/${category.slug}/subcategory/${sub.slug}`}
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
