import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ProductDetail } from "@/components/catalog/ProductDetail";
import { categories } from "@/data/categories";
import { brandsByCategory } from "@/data/category-brands";
import { products } from "@/data/products";

interface ProductPageProps {
  params: Promise<{ slug: string; brandSlug: string; productSlug: string }>;
}

export function generateStaticParams() {
  // A product compatible with several brands is reachable under each of those
  // brand paths, so it gets one static param per compatible brand within its
  // brand-type category.
  return products.flatMap((product) => {
    const categoryBrands = brandsByCategory[product.category];
    if (!categoryBrands) return [];
    return product.compatibleBrands
      .filter((brandSlug) => categoryBrands.some((brand) => brand.slug === brandSlug))
      .map((brandSlug) => ({ slug: product.category, brandSlug, productSlug: product.slug }));
  });
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { productSlug } = await params;
  const product = products.find((item) => item.slug === productSlug);
  return { title: product ? `${product.name} — AYPROM` : "Товар — AYPROM" };
}

export default async function BrandProductPage({ params }: ProductPageProps) {
  const { slug, brandSlug, productSlug } = await params;
  const category = categories.find((item) => item.slug === slug);
  const brandInCategory = brandsByCategory[slug]?.find((item) => item.slug === brandSlug);
  const product = products.find((item) => item.slug === productSlug);

  // The product must belong to this category and actually list this brand as
  // compatible — otherwise the path is invalid and 404s.
  if (
    !category ||
    !brandInCategory ||
    !product ||
    product.category !== slug ||
    !product.compatibleBrands.includes(brandSlug)
  ) {
    notFound();
  }

  return <ProductDetail product={product} />;
}
