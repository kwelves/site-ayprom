import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { ProductSearchForm } from "@/components/catalog/ProductSearchForm";
import { ProductGridWithSearch } from "@/components/catalog/ProductGridWithSearch";
import { categories } from "@/data/categories";
import { subcategoriesByCategory } from "@/data/subcategories";
import { products } from "@/data/products";

interface SubcategoryPageProps {
  params: Promise<{ slug: string; subSlug: string }>;
  searchParams: Promise<{ q?: string }>;
}

export function generateStaticParams() {
  return Object.entries(subcategoriesByCategory).flatMap(([categorySlug, subs]) =>
    subs.map((sub) => ({ slug: categorySlug, subSlug: sub.slug }))
  );
}

export async function generateMetadata({ params }: SubcategoryPageProps): Promise<Metadata> {
  const { slug, subSlug } = await params;
  const sub = subcategoriesByCategory[slug]?.find((item) => item.slug === subSlug);
  return { title: sub ? `${sub.name} — AYPROM` : "Каталог — AYPROM" };
}

export default async function SubcategoryProductsPage({ params, searchParams }: SubcategoryPageProps) {
  const { slug, subSlug } = await params;
  const { q } = await searchParams;
  const category = categories.find((item) => item.slug === slug);
  const subcategory = subcategoriesByCategory[slug]?.find((item) => item.slug === subSlug);

  if (!category || !subcategory) {
    notFound();
  }

  const subcategoryProducts = products.filter(
    (product) => product.category === slug && product.subcategory === subSlug
  );

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
