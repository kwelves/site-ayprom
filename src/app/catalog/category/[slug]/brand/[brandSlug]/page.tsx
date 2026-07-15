import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { ProductCard } from "@/components/catalog/ProductCard";
import { categories } from "@/data/categories";
import { brandsByCategory } from "@/data/category-brands";
import { products } from "@/data/products";

interface BrandInCategoryPageProps {
  params: Promise<{ slug: string; brandSlug: string }>;
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

export default async function BrandInCategoryPage({ params }: BrandInCategoryPageProps) {
  const { slug, brandSlug } = await params;
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

      {brandProducts.length > 0 ? (
        <StaggerGroup className="mt-10 grid grid-cols-2 gap-5 lg:grid-cols-4">
          {brandProducts.map((product) => (
            <StaggerItem key={product.slug}>
              <ProductCard
                product={product}
                href={`/catalog/category/${slug}/brand/${brandSlug}/${product.slug}`}
              />
            </StaggerItem>
          ))}
        </StaggerGroup>
      ) : (
        <p className="mt-10 text-center text-slate-600">
          Для этого бренда пока нет товаров. Скоро они здесь появятся.
        </p>
      )}
    </>
  );
}
