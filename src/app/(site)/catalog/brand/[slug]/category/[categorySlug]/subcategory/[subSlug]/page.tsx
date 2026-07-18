import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { ProductSearchForm } from "@/components/catalog/ProductSearchForm";
import { ProductGridWithSearch } from "@/components/catalog/ProductGridWithSearch";
import { getBrand } from "@/lib/queries/brands";
import { getCategory } from "@/lib/queries/categories";
import { getSubcategory } from "@/lib/queries/subcategories";
import { getProducts } from "@/lib/queries/products";

export const revalidate = 0;

interface BrandSubcategoryPageProps {
  params: Promise<{ slug: string; categorySlug: string; subSlug: string }>;
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({ params }: BrandSubcategoryPageProps): Promise<Metadata> {
  const { slug, subSlug, categorySlug } = await params;
  const [brand, subcategory] = await Promise.all([getBrand(slug), getSubcategory(categorySlug, subSlug)]);
  return { title: brand && subcategory ? `${subcategory.name} — ${brand.name} — AYPROM` : "Каталог — AYPROM" };
}

export default async function BrandSubcategoryPage({ params, searchParams }: BrandSubcategoryPageProps) {
  const { slug, categorySlug, subSlug } = await params;
  const { q } = await searchParams;
  const [brand, category, subcategory] = await Promise.all([
    getBrand(slug),
    getCategory(categorySlug),
    getSubcategory(categorySlug, subSlug),
  ]);

  if (!brand || !category || category.type !== "subcategory" || !subcategory) {
    notFound();
  }

  const products = await getProducts({ categorySlug, subcategorySlug: subSlug, brandSlug: slug });

  return (
    <>
      <Reveal>
        <SectionHeading className="mx-auto max-w-2xl text-center" eyebrow={brand.name} title={subcategory.name} />
      </Reveal>

      <div className="mt-6">
        <ProductSearchForm
          action={`/catalog/brand/${slug}/category/${categorySlug}/subcategory/${subSlug}`}
          defaultValue={q}
          placeholder={`Поиск по «${subcategory.name}» для «${brand.name}»`}
        />
      </div>

      <ProductGridWithSearch
        products={products}
        query={q}
        scopeLabel={`для «${brand.name}» в разделе «${subcategory.name}»`}
        href={(product) => `/catalog/category/${categorySlug}/subcategory/${subSlug}/${product.slug}`}
        emptyLabel={`Для «${brand.name}» пока нет товаров в разделе «${subcategory.name}». Скоро они здесь появятся.`}
      />
    </>
  );
}
