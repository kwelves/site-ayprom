import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Reveal } from "@/components/motion/Reveal";
import { categories } from "@/data/categories";
import { brandsByCategory } from "@/data/category-brands";

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

  return (
    <Reveal>
      <div className="text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">Каталог</p>
        <h1 className="mt-3 text-2xl font-bold text-foreground sm:text-3xl">
          {category.name} — {brand.name}
        </h1>
        <p className="mt-3 text-slate-600">
          Раздел в разработке. Скоро здесь появится каталог «{category.name.toLowerCase()}» для бренда «{brand.name}
          ».
        </p>
      </div>
    </Reveal>
  );
}
