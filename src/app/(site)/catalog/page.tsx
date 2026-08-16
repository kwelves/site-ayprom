import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { CatalogPageShell } from "@/components/catalog/CatalogPageShell";
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

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const { q, page: pageParam } = await searchParams;
  const page = parseCatalogPage(pageParam);
  const [productPage, categoryBrandSlugs] = await Promise.all([
    getProducts({ query: q, page }),
    getCategoryBrandSlugs(),
  ]);

  return (
    <CatalogPageShell>
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
    </CatalogPageShell>
  );
}
