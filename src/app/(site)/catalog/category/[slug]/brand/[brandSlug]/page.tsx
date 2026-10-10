import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Reveal } from "@/components/motion/Reveal";
import { ProductSearchForm } from "@/components/catalog/ProductSearchForm";
import { ProductGridWithSearch } from "@/components/catalog/ProductGridWithSearch";
import { ClientCatalogSearch } from "@/components/catalog/ClientCatalogSearch";
import { CatalogPageShell } from "@/components/catalog/CatalogPageShell";
import { getCategory } from "@/lib/queries/categories";
import { getCategoryBrands } from "@/lib/queries/category-brands";
import { getProducts, parseCatalogPage } from "@/lib/queries/products";

export const revalidate = 60;

// Static-build (Cloudflare crawl-and-freeze) delivery has no server to
// re-render on a new q/page after the HTML is frozen — see the subcategory
// page (../../subcategory/[subSlug]/page.tsx) for the full rationale. Normal
// Next/Vercel rendering below is untouched: it keeps computing productPage
// from the real request's q/page and rendering the existing server-driven
// ProductSearchForm + ProductGridWithSearch exactly as before.
const STATIC_BUILD = process.env.AYPROM_STATIC_BUILD === "1";

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

  // Static-build HTML must freeze a useful page-one without depending on
  // whatever q/page the crawler's request happened to carry — the client
  // adapter is what handles every other combination, after hydration. Normal
  // rendering keeps using the real request's q/page, unchanged.
  const productPage = await getProducts(
    STATIC_BUILD
      ? { categorySlug: slug, brandSlug }
      : { categorySlug: slug, brandSlug, query: q, page },
  );
  const action = `/catalog/category/${slug}/brand/${brandSlug}`;
  const scopeLabel = `для бренда «${brand.name}»`;
  const emptyLabel = "Для этого бренда пока нет товаров. Скоро они здесь появятся.";

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

      {STATIC_BUILD ? (
        <ClientCatalogSearch
          categorySlug={slug}
          brandSlug={brandSlug}
          basePath={action}
          initial={productPage}
          scopeLabel={scopeLabel}
          emptyLabel={emptyLabel}
          searchPlaceholder={`Поиск по «${brand.name}»`}
        />
      ) : (
        <>
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
            scopeLabel={scopeLabel}
            action={action}
            href={(product) => `${action}/${product.slug}`}
            emptyLabel={emptyLabel}
          />
        </>
      )}
    </CatalogPageShell>
  );
}
