import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { ProductSearchForm } from "@/components/catalog/ProductSearchForm";
import { ProductGridWithSearch } from "@/components/catalog/ProductGridWithSearch";
import { categories } from "@/data/categories";
import { brandsByCategory } from "@/data/category-brands";
import { products } from "@/data/products";

interface BrandInCategoryPageProps {
  params: Promise<{ slug: string; brandSlug: string }>;
  searchParams: Promise<{ q?: string }>;
}

export function generateStaticParams() {
  return Object.entries(brandsByCategory).flatMap(([categorySlug, categoryBrands]) =>
    categoryBrands.map((brand) => ({ slug: categorySlug, brandSlug: brand.slug }))
  );
}

export async function generateMetadata({ params }: BrandInCategoryPageProps): Promise<Metadata> {
  const { slug, brandSlug } = await params;
  const category = categories.find((item) => item.slug === slug);
  const brand = brandsByCategory[slug]?.find((item) => item.slug === brandSlug);
  return { title: category && brand ? `${category.name} — ${brand.name} — AYPROM` : "Каталог — AYPROM" };
}

export default async function BrandInCategoryPage({ params, searchParams }: BrandInCategoryPageProps) {
  const { slug, brandSlug } = await params;
  const { q } = await searchParams;
  const category = categories.find((item) => item.slug === slug);
  const brand = brandsByCategory[slug]?.find((item) => item.slug === brandSlug);

  if (!category || !brand) {
    notFound();
  }

  const brandProducts = products.filter(
    (product) => product.category === slug && product.compatibleBrands.includes(brandSlug)
  );

  return (
    <>
      <Reveal>
        <SectionHeading className="mx-auto max-w-2xl text-center" eyebrow={category.name} title={brand.name} />
      </Reveal>

      <div className="mt-6">
        <ProductSearchForm
          action={`/catalog/category/${slug}/brand/${brandSlug}`}
          defaultValue={q}
          placeholder={`Поиск по «${brand.name}»`}
        />
      </div>

      <ProductGridWithSearch
        products={brandProducts}
        query={q}
        scopeLabel={`для бренда «${brand.name}»`}
        href={(product) => `/catalog/category/${slug}/brand/${brandSlug}/${product.slug}`}
        emptyLabel="Для этого бренда пока нет товаров. Скоро они здесь появятся."
      />
    </>
  );
}
