import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { ProductCard } from "@/components/catalog/ProductCard";
import { categories } from "@/data/categories";
import { subcategoriesByCategory } from "@/data/subcategories";
import { products } from "@/data/products";

interface SubcategoryPageProps {
  params: Promise<{ slug: string; subSlug: string }>;
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

export default async function SubcategoryProductsPage({ params }: SubcategoryPageProps) {
  const { slug, subSlug } = await params;
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
        <SectionHeading
          className="mx-auto max-w-2xl text-center"
          eyebrow={category.name}
          title={subcategory.name}
        />
      </Reveal>

      {subcategoryProducts.length > 0 ? (
        <StaggerGroup className="mt-10 grid grid-cols-2 gap-5 lg:grid-cols-4">
          {subcategoryProducts.map((product) => (
            <StaggerItem key={product.slug}>
              <ProductCard
                product={product}
                href={`/catalog/category/${slug}/subcategory/${subSlug}/${product.slug}`}
              />
            </StaggerItem>
          ))}
        </StaggerGroup>
      ) : (
        <p className="mt-10 text-center text-slate-600">
          В этой подкатегории пока нет товаров. Скоро они здесь появятся.
        </p>
      )}
    </>
  );
}
