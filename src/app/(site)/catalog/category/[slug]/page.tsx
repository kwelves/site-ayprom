import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { HoverBorderGrid } from "@/components/motion/HoverBorderGrid";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { CategoryCard } from "@/components/home/CategoryCard";
import { BrandCard } from "@/components/home/BrandCard";
import { CatalogPageShell } from "@/components/catalog/CatalogPageShell";
import { ProductSearchForm } from "@/components/catalog/ProductSearchForm";
import { CatalogPagination, ProductGridWithSearch } from "@/components/catalog/ProductGridWithSearch";
import { ProductCard } from "@/components/catalog/ProductCard";
import { getCategory, getCategories } from "@/lib/queries/categories";
import { getSubcategories } from "@/lib/queries/subcategories";
import { getCategoryBrands } from "@/lib/queries/category-brands";
import { getProducts, getProductsWithoutSubcategory, parseCatalogPage } from "@/lib/queries/products";
import { CARD_GRID_GAP_CLASSNAME, getCardGridSizing } from "@/lib/card-system";
import { buildMixedCategoryGridItems } from "@/lib/mixed-category-grid";
import { cn } from "@/lib/utils";
import type { Brand } from "@/types/catalog";

export const revalidate = 60;

// A dynamic segment without generateStaticParams renders fully dynamic on
// every request regardless of `revalidate` — categories are few and known,
// so prerender all of them at build time instead of paying a cold-render
// cost on every visitor's first hit.
export async function generateStaticParams() {
  const categories = await getCategories();
  return categories.map((category) => ({ slug: category.slug }));
}

function BrandCardGrid({
  brands,
  categorySlug,
  className,
}: {
  brands: Brand[];
  categorySlug: string;
  className: string;
}) {
  const sizing = getCardGridSizing(brands.length);
  return (
    <HoverBorderGrid className={cn(className, sizing.containerClassName)}>
      <StaggerGroup className={cn("flex flex-wrap justify-center", CARD_GRID_GAP_CLASSNAME)}>
        {brands.map((brand) => (
          <StaggerItem key={brand.slug} className={sizing.itemClassName}>
            <BrandCard href={`/catalog/category/${categorySlug}/brand/${brand.slug}`} brand={brand} />
          </StaggerItem>
        ))}
      </StaggerGroup>
    </HoverBorderGrid>
  );
}

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategory(slug);
  return category
    ? {
        title: category.name,
        description: category.description || undefined,
        alternates: { canonical: `/catalog/category/${slug}` },
      }
    : { title: "Каталог", robots: { index: false } };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  const category = await getCategory(slug);

  if (!category) {
    notFound();
  }
  const categoryPath = `/catalog/category/${category.slug}`;

  if (category.type === null) {
    const { q, page: pageParam } = await searchParams;
    const page = parseCatalogPage(pageParam);
    const productPage = await getProducts({ categorySlug: slug, query: q, page });
    const action = `/catalog/category/${slug}`;

    return (
      <CatalogPageShell canonicalPath={categoryPath} items={[{ label: category.name }]}>
        <Reveal>
          <SectionHeading as="h1" className="mx-auto max-w-2xl text-center" title={category.name} />
        </Reveal>

        <div className="mt-6">
          <ProductSearchForm action={action} defaultValue={q} placeholder={`Поиск по разделу «${category.name}»`} />
        </div>

        <ProductGridWithSearch
          products={productPage.items}
          total={productPage.total}
          page={productPage.page}
          totalPages={productPage.totalPages}
          query={q}
          scopeLabel={`в разделе «${category.name}»`}
          action={action}
          href={(product) => `/catalog/category/${slug}/${product.slug}`}
          emptyLabel="В этой категории пока нет товаров. Скоро они здесь появятся."
        />

        {category.intro && (
          <Reveal>
            <p className="mx-auto mt-14 max-w-2xl text-center text-muted-foreground">{category.intro}</p>
          </Reveal>
        )}
      </CatalogPageShell>
    );
  }

  if (category.type === "brand") {
    const categoryBrands = await getCategoryBrands(category.slug);

    // Matches CategorySection's homepage grid exactly (same columns, gap, and
    // default CategoryCard/BrandCard sizing) so brand cards are pixel-for-pixel
    // the same size as the homepage catalog cards at every breakpoint.
    return (
      <CatalogPageShell canonicalPath={categoryPath} items={[{ label: category.name }]}>
        <Reveal>
          <SectionHeading as="h1" className="mx-auto max-w-2xl text-center" title={category.name} />
        </Reveal>

        <BrandCardGrid brands={categoryBrands} categorySlug={category.slug} className="mt-10" />

        <Reveal>
          <p className="mx-auto mt-14 max-w-2xl text-center text-muted-foreground">
            {category.intro
              ? `${category.intro} Выберите бренд, чтобы быстро найти нужные детали.`
              : "Выберите бренд, чтобы быстро найти нужные детали."}
          </p>
        </Reveal>
      </CatalogPageShell>
    );
  }

  const { page: pageParam } = await searchParams;
  const page = parseCatalogPage(pageParam);
  const [subcategories, directProductPage] = await Promise.all([
    getSubcategories(category.slug),
    getProductsWithoutSubcategory(category.slug, page),
  ]);

  if (subcategories.length === 0 && directProductPage.total === 0) {
    return (
      <CatalogPageShell canonicalPath={categoryPath} items={[{ label: category.name }]}>
        <Reveal>
          <div className="text-center">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">Каталог</p>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{category.name}</h1>
            <p className="mt-3 text-muted-foreground">
              Раздел в разработке. Скоро здесь появится каталог этой категории.
            </p>
          </div>
        </Reveal>
      </CatalogPageShell>
    );
  }

  const mixedItems = buildMixedCategoryGridItems(subcategories, directProductPage.items);
  const sizing = getCardGridSizing(mixedItems.length);
  return (
    <CatalogPageShell canonicalPath={categoryPath} items={[{ label: category.name }]}>
      <Reveal>
        <SectionHeading
          as="h1"
          className="mx-auto max-w-2xl text-center"
          title={category.name}
          description={
            subcategories.length > 0
              ? directProductPage.total > 0
                ? "Выберите подкатегорию или нужный товар."
                : "Выберите подкатегорию, чтобы быстро найти нужные детали."
              : undefined
          }
        />
      </Reveal>
      <HoverBorderGrid
        className={cn(
          "mt-10",
          sizing.containerClassName
        )}
      >
        <StaggerGroup className={cn("flex flex-wrap justify-center", CARD_GRID_GAP_CLASSNAME)}>
          {mixedItems.map(({ kind, item }) => (
            <StaggerItem key={`${kind}:${item.slug}`} className={sizing.itemClassName}>
              {kind === "subcategory" ? (
                <CategoryCard
                  href={`/catalog/category/${category.slug}/subcategory/${item.slug}`}
                  image={item.image}
                  name={item.name}
                  sizes="(max-width: 1023px) 30vw, 380px"
                />
              ) : (
                <ProductCard product={item} href={`${categoryPath}/${item.slug}`} variant="category-grid" />
              )}
            </StaggerItem>
          ))}
        </StaggerGroup>
      </HoverBorderGrid>

      <CatalogPagination
        action={categoryPath}
        page={directProductPage.page}
        totalPages={directProductPage.totalPages}
      />
    </CatalogPageShell>
  );
}
