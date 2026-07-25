import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { ProductSearchForm } from "@/components/catalog/ProductSearchForm";
import { ProductGridWithSearch } from "@/components/catalog/ProductGridWithSearch";
import { getSubcategory } from "@/lib/queries/subcategories";
import { getProducts, parseCatalogPage } from "@/lib/queries/products";

export const revalidate = 60;

interface SubcategoryPageProps {
  params: Promise<{ slug: string; subSlug: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}

export async function generateMetadata({ params }: SubcategoryPageProps): Promise<Metadata> {
  const { slug, subSlug } = await params;
  const sub = await getSubcategory(slug, subSlug);
  return sub
    ? {
        title: sub.name,
        description: sub.intro,
        alternates: { canonical: `/catalog/category/${slug}/subcategory/${subSlug}` },
      }
    : { title: "Каталог", robots: { index: false } };
}

export default async function SubcategoryProductsPage({ params, searchParams }: SubcategoryPageProps) {
  const { slug, subSlug } = await params;
  const { q, page: pageParam } = await searchParams;
  const page = parseCatalogPage(pageParam);
  const subcategory = await getSubcategory(slug, subSlug);

  if (!subcategory) {
    notFound();
  }

  const productPage = await getProducts({ categorySlug: slug, subcategorySlug: subSlug, query: q, page });
  const action = `/catalog/category/${slug}/subcategory/${subSlug}`;

  return (
    <>
      <Reveal>
        <SectionHeading as="h1" className="mx-auto max-w-2xl text-center" title={subcategory.name} />
      </Reveal>

      <div className="mt-6">
        <ProductSearchForm
          action={action}
          defaultValue={q}
          placeholder={`Поиск по разделу «${subcategory.name}»`}
        />
      </div>

      <ProductGridWithSearch
        products={productPage.items}
        total={productPage.total}
        page={productPage.page}
        totalPages={productPage.totalPages}
        query={q}
        scopeLabel={`в разделе «${subcategory.name}»`}
        action={action}
        href={(product) => `/catalog/category/${slug}/subcategory/${subSlug}/${product.slug}`}
        emptyLabel="В этой подкатегории пока нет товаров. Скоро они здесь появятся."
      />

      {subcategory.intro && (
        <Reveal>
          <p className="mx-auto mt-14 max-w-2xl text-center text-slate-600">{subcategory.intro}</p>
        </Reveal>
      )}
    </>
  );
}
