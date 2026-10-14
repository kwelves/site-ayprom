import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { CatalogPageShell } from "@/components/catalog/CatalogPageShell";
import { Reveal } from "@/components/motion/Reveal";
import { ProductSearchForm } from "@/components/catalog/ProductSearchForm";
import { ProductGridWithSearch } from "@/components/catalog/ProductGridWithSearch";
import { ClientCatalogSearch } from "@/components/catalog/ClientCatalogSearch";
import { getProducts, parseCatalogPage } from "@/lib/queries/products";
import { getCategoryBrandSlugs } from "@/lib/queries/category-brands";
import { getDirectProductCategorySlugs } from "@/lib/queries/categories";
import { getProductHref } from "@/lib/product-href";

export const metadata: Metadata = {
  title: "Каталог",
  alternates: { canonical: "/catalog" },
};

export const revalidate = 60;

// /catalog is a cross-category listing — every other page family wired to
// static-build search links every product from one shared basePath, but
// here each product can be in any category/subcategory/brand, so the client
// adapter needs `productRouting` (getProductHref) instead. See
// docs/superpowers/reports/2026-09-24-claude-remaining-catalog-static-audit.md.
const STATIC_BUILD = process.env.AYPROM_STATIC_BUILD === "1";

interface CatalogPageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const { q, page: pageParam } = await searchParams;
  const page = parseCatalogPage(pageParam);
  // Static-build HTML must freeze a useful page-one without depending on
  // whatever q/page the crawler's request happened to carry — the client
  // adapter handles every other combination after hydration. Normal
  // rendering keeps using the real request's q/page, unchanged.
  const [productPage, categoryBrandSlugs, directProductCategorySlugs] = await Promise.all([
    getProducts(STATIC_BUILD ? {} : { query: q, page }),
    getCategoryBrandSlugs(),
    getDirectProductCategorySlugs(),
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

        {STATIC_BUILD ? (
          <ClientCatalogSearch
            basePath="/catalog"
            productRouting={{
              categoryBrandSlugs,
              directProductCategorySlugs: [...directProductCategorySlugs],
            }}
            initial={productPage}
            scopeLabel="в каталоге"
            emptyLabel="Каталог пока пуст. Скоро здесь появятся товары."
            searchPlaceholder="Например: гидроцилиндр HOWO"
          />
        ) : (
          <>
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
              href={(product) => getProductHref(product, categoryBrandSlugs, directProductCategorySlugs)}
              emptyLabel="Каталог пока пуст. Скоро здесь появятся товары."
            />
          </>
        )}
    </CatalogPageShell>
  );
}
