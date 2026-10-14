import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { ProductSearchForm } from "@/components/catalog/ProductSearchForm";
import { ProductGridWithSearch } from "@/components/catalog/ProductGridWithSearch";
import { ClientCatalogSearch } from "@/components/catalog/ClientCatalogSearch";
import { CatalogPageShell } from "@/components/catalog/CatalogPageShell";
import { getBrand } from "@/lib/queries/brands";
import { getCategory } from "@/lib/queries/categories";
import { getSubcategory } from "@/lib/queries/subcategories";
import { getProducts, parseCatalogPage } from "@/lib/queries/products";

export const revalidate = 60;

// Static-build (Cloudflare crawl-and-freeze) delivery has no server to
// re-render on a new q/page after the HTML is frozen — see the plain
// subcategory page (catalog/category/[slug]/subcategory/[subSlug]/page.tsx)
// for the full rationale. Normal Next/Vercel rendering below is untouched.
const STATIC_BUILD = process.env.AYPROM_STATIC_BUILD === "1";

interface BrandSubcategoryPageProps {
  params: Promise<{ slug: string; categorySlug: string; subSlug: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}

export async function generateMetadata({ params }: BrandSubcategoryPageProps): Promise<Metadata> {
  const { slug, subSlug, categorySlug } = await params;
  const [brand, subcategory] = await Promise.all([getBrand(slug), getSubcategory(categorySlug, subSlug)]);
  return brand && subcategory
    ? {
        title: `${subcategory.name} — ${brand.name}`,
        description: `${subcategory.name}, совместимые с техникой ${brand.name}.`,
        alternates: { canonical: `/catalog/brand/${slug}/category/${categorySlug}/subcategory/${subSlug}` },
      }
    : { title: "Каталог", robots: { index: false } };
}

export default async function BrandSubcategoryPage({ params, searchParams }: BrandSubcategoryPageProps) {
  const { slug, categorySlug, subSlug } = await params;
  const { q, page: pageParam } = await searchParams;
  const page = parseCatalogPage(pageParam);
  const [brand, category, subcategory] = await Promise.all([
    getBrand(slug),
    getCategory(categorySlug),
    getSubcategory(categorySlug, subSlug),
  ]);

  if (!brand || !category || category.type !== "subcategory" || !subcategory) {
    notFound();
  }

  // Static-build HTML must freeze a useful page-one without depending on
  // whatever q/page the crawler's request happened to carry — the client
  // adapter is what handles every other combination, after hydration. Normal
  // rendering keeps using the real request's q/page, unchanged.
  const productPage = await getProducts(
    STATIC_BUILD
      ? { categorySlug, subcategorySlug: subSlug, brandSlug: slug }
      : { categorySlug, subcategorySlug: subSlug, brandSlug: slug, query: q, page },
  );
  const action = `/catalog/brand/${slug}/category/${categorySlug}/subcategory/${subSlug}`;
  // The list paginates at `action` (brand-scoped), but every product's real,
  // canonical URL is the one plain subcategory page would use — the same
  // product page must never have two different incoming links.
  const productBasePath = `/catalog/category/${categorySlug}/subcategory/${subSlug}`;
  const scopeLabel = `для «${brand.name}» в разделе «${subcategory.name}»`;
  const emptyLabel = `Для «${brand.name}» пока нет товаров в разделе «${subcategory.name}». Скоро они здесь появятся.`;

  return (
    <CatalogPageShell
      canonicalPath={action}
      items={[
        { label: brand.name, href: `/catalog/brand/${slug}` },
        { label: category.name, href: `/catalog/brand/${slug}/category/${categorySlug}` },
        { label: subcategory.name },
      ]}
    >
      <Reveal>
        <SectionHeading
          as="h1"
          className="mx-auto max-w-2xl text-center"
          eyebrow={brand.name}
          title={subcategory.name}
        />
      </Reveal>

      {STATIC_BUILD ? (
        <ClientCatalogSearch
          categorySlug={categorySlug}
          subcategorySlug={subSlug}
          brandSlug={slug}
          basePath={action}
          productBasePath={productBasePath}
          initial={productPage}
          scopeLabel={scopeLabel}
          emptyLabel={emptyLabel}
          searchPlaceholder={`Поиск по «${subcategory.name}» для «${brand.name}»`}
        />
      ) : (
        <>
          <div className="mt-6">
            <ProductSearchForm
              action={action}
              defaultValue={q}
              placeholder={`Поиск по «${subcategory.name}» для «${brand.name}»`}
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
            href={(product) => `${productBasePath}/${product.slug}`}
            emptyLabel={emptyLabel}
          />
        </>
      )}
    </CatalogPageShell>
  );
}
