import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BackButton } from "@/components/ui/BackButton";
import { Reveal } from "@/components/motion/Reveal";
import { ProductSearchForm } from "@/components/catalog/ProductSearchForm";
import { ProductGridWithSearch } from "@/components/catalog/ProductGridWithSearch";
import { getProducts, parseCatalogPage } from "@/lib/queries/products";
import { getCategoryBrandSlugs } from "@/lib/queries/category-brands";
import { getProductHref } from "@/lib/product-href";

export const metadata: Metadata = {
  title: "Каталог",
  alternates: { canonical: "/catalog" },
};

export const revalidate = 60;

interface CatalogPageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

// No shared layout.tsx here on purpose — /catalog/category/[slug] and
// /catalog/brand/[slug] already have their own layout with a BackButton;
// a layout at this level would wrap those too and duplicate the button.
export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const { q, page: pageParam } = await searchParams;
  const page = parseCatalogPage(pageParam);
  const [productPage, categoryBrandSlugs] = await Promise.all([
    getProducts({ query: q, page }),
    getCategoryBrandSlugs(),
  ]);

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
          <ProductSearchForm action="/catalog" defaultValue={q} placeholder="Например: гидроцилиндр HOWO" />
        </div>

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
        />
      </div>
    </Container>
  );
}
