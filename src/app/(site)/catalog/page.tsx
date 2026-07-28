import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BackButton } from "@/components/ui/BackButton";
import { Reveal } from "@/components/motion/Reveal";
import { ProductSearchForm } from "@/components/catalog/ProductSearchForm";
import { ProductGridWithSearch } from "@/components/catalog/ProductGridWithSearch";
import { FilterRail, buildFacetGroups } from "@/components/catalog/FilterRail";
import { FilterSheet } from "@/components/catalog/FilterSheet";
import { getProducts, parseCatalogPage } from "@/lib/queries/products";
import { getCategoryBrandSlugs } from "@/lib/queries/category-brands";
import { getCategories } from "@/lib/queries/categories";
import { getBrands } from "@/lib/queries/brands";
import { getVehicleTypes } from "@/lib/queries/vehicle-types";
import { getProductHref } from "@/lib/product-href";
import { activeFacetParams, type CatalogFilterParams } from "@/lib/catalog-filters";

export const metadata: Metadata = {
  title: "Каталог",
  alternates: { canonical: "/catalog" },
};

export const revalidate = 60;

interface CatalogPageProps {
  searchParams: Promise<{ q?: string; page?: string; category?: string; brand?: string; vehicleType?: string }>;
}

// No shared layout.tsx here on purpose — /catalog/category/[slug] and
// /catalog/brand/[slug] already have their own layout with a BackButton;
// a layout at this level would wrap those too and duplicate the button.
export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const { q, page: pageParam, category, brand, vehicleType } = await searchParams;
  const page = parseCatalogPage(pageParam);
  const current: CatalogFilterParams = { q, category, brand, vehicleType };

  const [productPage, categoryBrandSlugs, categories, brands, vehicleTypes] = await Promise.all([
    getProducts({ query: q, page, categorySlug: category, brandSlug: brand, vehicleTypeSlug: vehicleType }),
    getCategoryBrandSlugs(),
    getCategories(),
    getBrands(),
    getVehicleTypes(),
  ]);

  const facetGroups = buildFacetGroups({ current, categories, brands, vehicleTypes });
  const extraParams = activeFacetParams(current);

  return (
    <Container className="pt-6 pb-16 sm:pt-8 sm:pb-20 lg:pt-10 lg:pb-24">
      <BackButton />
      <div className="mt-14">
        <Reveal>
          <SectionHeading
            as="h1"
            className="mx-auto max-w-2xl text-center"
            eyebrow="Каталог"
            title="Все товары"
            description="Выберите категорию или бренд на главной, чтобы быстрее найти нужную позицию."
          />
        </Reveal>

        <div className="mt-6">
          <ProductSearchForm
            action="/catalog"
            defaultValue={q}
            placeholder="Например: гидроцилиндр HOWO"
            hiddenParams={extraParams}
          />
        </div>

        <FilterSheet current={current} groups={facetGroups} className="mt-6 lg:hidden" />

        <div className="mt-6 lg:grid lg:grid-cols-[220px_1fr] lg:items-start lg:gap-8">
          <FilterRail current={current} categories={categories} brands={brands} vehicleTypes={vehicleTypes} className="hidden lg:block" />

          <div>
            <ProductGridWithSearch
              products={productPage.items}
              total={productPage.total}
              page={productPage.page}
              totalPages={productPage.totalPages}
              query={q}
              scopeLabel="в каталоге"
              action="/catalog"
              href={(product) => getProductHref(product, categoryBrandSlugs)}
              emptyLabel="Каталог пока пуст. Скоро здесь появятся товары."
              extraParams={extraParams}
            />
          </div>
        </div>
      </div>
    </Container>
  );
}
