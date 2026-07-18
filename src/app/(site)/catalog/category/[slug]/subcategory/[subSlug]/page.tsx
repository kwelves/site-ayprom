import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { ProductSearchForm } from "@/components/catalog/ProductSearchForm";
import { ProductGridWithSearch } from "@/components/catalog/ProductGridWithSearch";
import { getSubcategory } from "@/lib/queries/subcategories";
import { getProducts } from "@/lib/queries/products";

export const revalidate = 0;

interface SubcategoryPageProps {
  params: Promise<{ slug: string; subSlug: string }>;
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({ params }: SubcategoryPageProps): Promise<Metadata> {
  const { slug, subSlug } = await params;
  const sub = await getSubcategory(slug, subSlug);
  return { title: sub ? `${sub.name} — AYPROM` : "Каталог — AYPROM" };
}

export default async function SubcategoryProductsPage({ params, searchParams }: SubcategoryPageProps) {
  const { slug, subSlug } = await params;
  const { q } = await searchParams;
  const subcategory = await getSubcategory(slug, subSlug);

  if (!subcategory) {
    notFound();
  }

  const subcategoryProducts = await getProducts({ categorySlug: slug, subcategorySlug: subSlug });

  return (
    <>
      <Reveal>
        <SectionHeading className="mx-auto max-w-2xl text-center" title={subcategory.name} />
      </Reveal>

      <div className="mt-6">
        <ProductSearchForm
          action={`/catalog/category/${slug}/subcategory/${subSlug}`}
          defaultValue={q}
          placeholder={`Поиск по разделу «${subcategory.name}»`}
        />
      </div>

      <ProductGridWithSearch
        products={subcategoryProducts}
        query={q}
        scopeLabel={`в разделе «${subcategory.name}»`}
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
