import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ProductDetail } from "@/components/catalog/ProductDetail";
import { getCategoryBrands } from "@/lib/queries/category-brands";
import { getProduct } from "@/lib/queries/products";

export const revalidate = 0;

interface ProductPageProps {
  params: Promise<{ slug: string; brandSlug: string; productSlug: string }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { productSlug } = await params;
  const product = await getProduct(productSlug);
  return { title: product ? `${product.name} — AYPROM` : "Товар — AYPROM" };
}

export default async function BrandProductPage({ params }: ProductPageProps) {
  const { slug, brandSlug, productSlug } = await params;
  const [categoryBrands, product] = await Promise.all([getCategoryBrands(slug), getProduct(productSlug)]);
  const brandInCategory = categoryBrands.find((item) => item.slug === brandSlug);

  // The product must belong to this category and actually list this brand as
  // compatible — otherwise the path is invalid and 404s.
  if (
    !brandInCategory ||
    !product ||
    product.category !== slug ||
    !product.compatibleBrands.includes(brandSlug)
  ) {
    notFound();
  }

  return <ProductDetail product={product} />;
}
