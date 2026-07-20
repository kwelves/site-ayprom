import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { ProductSearchForm } from "@/components/catalog/ProductSearchForm";
import { ProductGridWithSearch } from "@/components/catalog/ProductGridWithSearch";
import { getVehicleType } from "@/lib/queries/vehicle-types";
import { getCategoryBrandSlugs } from "@/lib/queries/category-brands";
import { getProducts } from "@/lib/queries/products";
import { getProductHref } from "@/lib/product-href";

export const revalidate = 60;

interface VehicleTypePageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({ params }: VehicleTypePageProps): Promise<Metadata> {
  const { slug } = await params;
  const vehicleType = await getVehicleType(slug);
  return { title: vehicleType ? `${vehicleType.name} — AYPROM` : "Каталог — AYPROM" };
}

// Cross-category listing (like /catalog/brand/[slug]) rather than a page
// nested under one category — products link out via getProductHref to
// their canonical category-based URL instead of a URL under this route.
export default async function VehicleTypePage({ params, searchParams }: VehicleTypePageProps) {
  const { slug } = await params;
  const { q } = await searchParams;
  const [vehicleType, vehicleTypeProducts, categoryBrandSlugs] = await Promise.all([
    getVehicleType(slug),
    getProducts({ vehicleTypeSlug: slug }),
    getCategoryBrandSlugs(),
  ]);

  if (!vehicleType) {
    notFound();
  }

  return (
    <>
      <Reveal>
        <SectionHeading className="mx-auto max-w-2xl text-center" title={vehicleType.name} />
      </Reveal>

      <div className="mt-6">
        <ProductSearchForm
          action={`/catalog/vehicle-type/${slug}`}
          defaultValue={q}
          placeholder={`Поиск по «${vehicleType.name}»`}
        />
      </div>

      <ProductGridWithSearch
        products={vehicleTypeProducts}
        query={q}
        scopeLabel={`для «${vehicleType.name}»`}
        href={(product) => getProductHref(product, categoryBrandSlugs)}
        emptyLabel="Для этого типа техники пока нет товаров. Скоро они здесь появятся."
      />
    </>
  );
}
