import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { ProductSearchForm } from "@/components/catalog/ProductSearchForm";
import { ProductGridWithSearch } from "@/components/catalog/ProductGridWithSearch";
import { ClientCatalogSearch } from "@/components/catalog/ClientCatalogSearch";
import { getVehicleType } from "@/lib/queries/vehicle-types";
import { getCategoryBrandSlugs } from "@/lib/queries/category-brands";
import { getDirectProductCategorySlugs } from "@/lib/queries/categories";
import { getProducts, parseCatalogPage } from "@/lib/queries/products";
import { getProductHref } from "@/lib/product-href";
import { getVehicleTypeSeo } from "@/lib/vehicle-type-seo";

export const revalidate = 60;

// Like /catalog, this is a cross-category listing (products of one vehicle
// type can live in any category/subcategory/brand), so the client adapter
// needs `productRouting` (getProductHref), not a shared basePath. See
// docs/superpowers/reports/2026-09-24-claude-remaining-catalog-static-audit.md.
const STATIC_BUILD = process.env.AYPROM_STATIC_BUILD === "1";

interface VehicleTypePageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}

export async function generateMetadata({ params }: VehicleTypePageProps): Promise<Metadata> {
  const { slug } = await params;
  const vehicleType = await getVehicleType(slug);
  if (!vehicleType) return { title: "Каталог", robots: { index: false } };

  const seo = getVehicleTypeSeo(slug);
  return {
    title: seo?.title ?? vehicleType.name,
    description: seo?.description ?? `Гидрооборудование и запчасти для техники: ${vehicleType.name}.`,
    alternates: { canonical: `/catalog/vehicle-type/${slug}` },
  };
}

// Cross-category listing (like /catalog/brand/[slug]) rather than a page
// nested under one category — products link out via getProductHref to
// their canonical category-based URL instead of a URL under this route.
export default async function VehicleTypePage({ params, searchParams }: VehicleTypePageProps) {
  const { slug } = await params;
  const { q, page: pageParam } = await searchParams;
  const page = parseCatalogPage(pageParam);
  // Static-build HTML must freeze a useful page-one without depending on
  // whatever q/page the crawler's request happened to carry — the client
  // adapter handles every other combination after hydration. Normal
  // rendering keeps using the real request's q/page, unchanged.
  const [vehicleType, productPage, categoryBrandSlugs, directProductCategorySlugs] = await Promise.all([
    getVehicleType(slug),
    getProducts(
      STATIC_BUILD ? { vehicleTypeSlug: slug } : { vehicleTypeSlug: slug, query: q, page },
    ),
    getCategoryBrandSlugs(),
    getDirectProductCategorySlugs(),
  ]);
  const action = `/catalog/vehicle-type/${slug}`;
  const seo = getVehicleTypeSeo(slug);

  if (!vehicleType) {
    notFound();
  }

  return (
    <>
      <Reveal>
        <SectionHeading as="h1" className="mx-auto max-w-2xl text-center" title={vehicleType.name} />
      </Reveal>

      {STATIC_BUILD ? (
        <ClientCatalogSearch
          vehicleTypeSlug={slug}
          basePath={action}
          productRouting={{
            categoryBrandSlugs,
            directProductCategorySlugs: [...directProductCategorySlugs],
          }}
          initial={productPage}
          scopeLabel={`для «${vehicleType.name}»`}
          emptyLabel="Для этого типа техники пока нет товаров. Скоро они здесь появятся."
          searchPlaceholder={`Поиск по «${vehicleType.name}»`}
        />
      ) : (
        <>
          <div className="mt-6">
            <ProductSearchForm
              action={action}
              defaultValue={q}
              placeholder={`Поиск по «${vehicleType.name}»`}
            />
          </div>

          <ProductGridWithSearch
            products={productPage.items}
            total={productPage.total}
            page={productPage.page}
            totalPages={productPage.totalPages}
            query={q}
            scopeLabel={`для «${vehicleType.name}»`}
            action={action}
            href={(product) => getProductHref(product, categoryBrandSlugs, directProductCategorySlugs)}
            emptyLabel="Для этого типа техники пока нет товаров. Скоро они здесь появятся."
          />
        </>
      )}

      {seo && (
        <Reveal>
          <p className="mx-auto mt-14 max-w-2xl text-center text-muted-foreground">{seo.intro}</p>
        </Reveal>
      )}
    </>
  );
}
