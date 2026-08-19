import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { ProductSearchForm } from "@/components/catalog/ProductSearchForm";
import { ProductGridWithSearch } from "@/components/catalog/ProductGridWithSearch";
import { getVehicleType } from "@/lib/queries/vehicle-types";
import { getCategoryBrandSlugs } from "@/lib/queries/category-brands";
import { getDirectCategorySlugs } from "@/lib/queries/categories";
import { getProducts, parseCatalogPage } from "@/lib/queries/products";
import { getProductHref } from "@/lib/product-href";

export const revalidate = 60;

interface VehicleTypePageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}

export async function generateMetadata({ params }: VehicleTypePageProps): Promise<Metadata> {
  const { slug } = await params;
  const vehicleType = await getVehicleType(slug);
  return vehicleType
    ? {
        title: vehicleType.name,
        description: `Гидрооборудование и запчасти для техники: ${vehicleType.name}.`,
        alternates: { canonical: `/catalog/vehicle-type/${slug}` },
      }
    : { title: "Каталог", robots: { index: false } };
}

// Cross-category listing (like /catalog/brand/[slug]) rather than a page
// nested under one category — products link out via getProductHref to
// their canonical category-based URL instead of a URL under this route.
export default async function VehicleTypePage({ params, searchParams }: VehicleTypePageProps) {
  const { slug } = await params;
  const { q, page: pageParam } = await searchParams;
  const page = parseCatalogPage(pageParam);
  const [vehicleType, productPage, categoryBrandSlugs, directCategorySlugs] = await Promise.all([
    getVehicleType(slug),
    getProducts({ vehicleTypeSlug: slug, query: q, page }),
    getCategoryBrandSlugs(),
    getDirectCategorySlugs(),
  ]);
  const action = `/catalog/vehicle-type/${slug}`;

  if (!vehicleType) {
    notFound();
  }

  return (
    <>
      <Reveal>
        <SectionHeading as="h1" className="mx-auto max-w-2xl text-center" title={vehicleType.name} />
      </Reveal>

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
        href={(product) => getProductHref(product, categoryBrandSlugs, directCategorySlugs)}
        emptyLabel="Для этого типа техники пока нет товаров. Скоро они здесь появятся."
      />
    </>
  );
}
