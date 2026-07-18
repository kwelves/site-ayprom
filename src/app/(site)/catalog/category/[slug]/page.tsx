import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { CategoryCard } from "@/components/home/CategoryCard";
import { BrandCard } from "@/components/home/BrandCard";
import { getCategory } from "@/lib/queries/categories";
import { getSubcategories } from "@/lib/queries/subcategories";
import { getCategoryBrands } from "@/lib/queries/category-brands";
import { getCategoryGridSizing } from "@/lib/category-grid";
import { cn } from "@/lib/utils";
import type { Brand } from "@/types/catalog";

export const revalidate = 0;

function BrandCardGrid({
  brands,
  categorySlug,
  className,
}: {
  brands: Brand[];
  categorySlug: string;
  className: string;
}) {
  return (
    <StaggerGroup className={className}>
      {brands.map((brand) => (
        <StaggerItem key={brand.slug}>
          <BrandCard href={`/catalog/category/${categorySlug}/brand/${brand.slug}`} brand={brand} />
        </StaggerItem>
      ))}
    </StaggerGroup>
  );
}

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategory(slug);
  return { title: category ? `${category.name} — AYPROM` : "Каталог — AYPROM" };
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { slug } = await params;
  const category = await getCategory(slug);

  if (!category) {
    notFound();
  }

  if (category.type === "brand") {
    const categoryBrands = await getCategoryBrands(category.slug);
    const forBrands = categoryBrands.filter((brand) => brand.relation === "for");
    const fromBrands = categoryBrands.filter((brand) => brand.relation === "from");
    // Same convention as the homepage brand section and the product-page
    // brand split: only label the two groups when both actually have
    // entries — right now every pto/pto-shafts brand is "for"-type, so this
    // renders as a single plain grid until a "от" brand joins that list.
    const showSplit = forBrands.length > 0 && fromBrands.length > 0;

    // Matches CategorySection's homepage grid exactly (same columns, gap, and
    // default CategoryCard/BrandCard sizing) so brand cards are pixel-for-pixel
    // the same size as the homepage catalog cards at every breakpoint.
    return (
      <>
        <Reveal>
          <SectionHeading className="mx-auto max-w-2xl text-center" title={category.name} />
        </Reveal>

        {showSplit ? (
          <>
            <p className="mt-10 text-center text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Для бренда
            </p>
            <BrandCardGrid
              brands={forBrands}
              categorySlug={category.slug}
              className="mt-4 grid grid-cols-2 gap-5 lg:grid-cols-4"
            />

            <p className="mt-10 text-center text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              От бренда
            </p>
            <BrandCardGrid
              brands={fromBrands}
              categorySlug={category.slug}
              className="mt-4 grid grid-cols-2 gap-5 lg:grid-cols-4"
            />
          </>
        ) : (
          <BrandCardGrid
            brands={categoryBrands}
            categorySlug={category.slug}
            className="mt-10 grid grid-cols-2 gap-5 lg:grid-cols-4"
          />
        )}

        <Reveal>
          <p className="mx-auto mt-14 max-w-2xl text-center text-slate-600">
            {category.intro
              ? `${category.intro} Выберите бренд, чтобы быстро найти нужные детали.`
              : "Выберите бренд, чтобы быстро найти нужные детали."}
          </p>
        </Reveal>
      </>
    );
  }

  const subcategories = await getSubcategories(category.slug);

  if (subcategories.length === 0) {
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
