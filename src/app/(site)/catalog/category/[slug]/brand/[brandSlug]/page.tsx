import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Reveal } from "@/components/motion/Reveal";
import { ProductSearchForm } from "@/components/catalog/ProductSearchForm";
import { ProductGridWithSearch } from "@/components/catalog/ProductGridWithSearch";
import { CatalogPageShell } from "@/components/catalog/CatalogPageShell";
import { getCategory } from "@/lib/queries/categories";
import { getCategoryBrands } from "@/lib/queries/category-brands";
import { getProducts, parseCatalogPage } from "@/lib/queries/products";

export const revalidate = 60;

interface BrandInCategoryPageProps {
  params: Promise<{ slug: string; brandSlug: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}

export async function generateMetadata({ params }: BrandInCategoryPageProps): Promise<Metadata> {
  const { slug, brandSlug } = await params;
  const [category, categoryBrands] = await Promise.all([getCategory(slug), getCategoryBrands(slug)]);
  const brand = categoryBrands.find((item) => item.slug === brandSlug);
  return category && brand
    ? {
        title: `${category.name} — ${brand.name}`,
        description: `${category.name} для техники ${brand.name}.`,
        alternates: { canonical: `/catalog/category/${slug}/brand/${brandSlug}` },
      }
    : { title: "Каталог", robots: { index: false } };
}

export default async function BrandInCategoryPage({ params, searchParams }: BrandInCategoryPageProps) {
  const { slug, brandSlug } = await params;
  const { q, page: pageParam } = await searchParams;
  const page = parseCatalogPage(pageParam);
  const [category, categoryBrands] = await Promise.all([getCategory(slug), getCategoryBrands(slug)]);
  const brand = categoryBrands.find((item) => item.slug === brandSlug);

  if (!category || !brand) {
    notFound();
  }

  const productPage = await getProducts({ categorySlug: slug, brandSlug, query: q, page });
  const action = `/catalog/category/${slug}/brand/${brandSlug}`;

  return (
    <CatalogPageShell
      canonicalPath={action}
      items={[
        { label: category.name, href: `/catalog/category/${slug}` },
        { label: brand.name },
      ]}
    >
      <Reveal>
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">{category.name}</p>
          <span className="mt-3 flex h-16 w-32 items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- static local SVGs are already optimal; next/image blocks local SVGs without dangerouslyAllowSVG */}
            <img
              src={brand.logo}
              alt={`Логотип ${brand.name}`}
              width={128}
              height={64}
              className="max-h-full max-w-full object-contain"
              style={brand.logoScale ? { transform: `scale(${brand.logoScale})` } : undefined}
            />
          </span>
          {/* Visually hidden — the logo above already identifies the brand
              on screen, but the page still needs a real text heading for
              SEO and screen readers. */}
          <h1 className="sr-only">{brand.name}</h1>
        </div>
      </Reveal>

      <div className="mt-6">
        <ProductSearchForm
          action={action}
          defaultValue={q}
          placeholder={`Поиск по «${brand.name}»`}
        />
      </div>

      <ProductGridWithSearch
        products={productPage.items}
        total={productPage.total}
        page={productPage.page}
        totalPages={productPage.totalPages}
        query={q}
        scopeLabel={`для бренда «${brand.name}»`}
        action={action}
        href={(product) => `/catalog/category/${slug}/brand/${brandSlug}/${product.slug}`}
        emptyLabel="Для этого бренда пока нет товаров. Скоро они здесь появятся."
      />
    </CatalogPageShell>
  );
}
