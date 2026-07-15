import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ProductDetail } from "@/components/catalog/ProductDetail";
import { categories } from "@/data/categories";
import { subcategoriesByCategory } from "@/data/subcategories";
import { products } from "@/data/products";

interface ProductPageProps {
  params: Promise<{ slug: string; subSlug: string; productSlug: string }>;
}

export function generateStaticParams() {
  return products
    .filter((product) => product.subcategory)
    .map((product) => ({
      slug: product.category,
      subSlug: product.subcategory as string,
      productSlug: product.slug,
    }));
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { productSlug } = await params;
  const product = products.find((item) => item.slug === productSlug);
  return { title: product ? `${product.name} — AYPROM` : "Товар — AYPROM" };
}

export default async function SubcategoryProductPage({ params }: ProductPageProps) {
  const { slug, subSlug, productSlug } = await params;
  const category = categories.find((item) => item.slug === slug);
  const subcategory = subcategoriesByCategory[slug]?.find((item) => item.slug === subSlug);
  const product = products.find((item) => item.slug === productSlug);

  // The product must actually belong to this exact category + subcategory —
  // otherwise a mismatched path (e.g. a pump under a tanks URL) 404s instead
  // of rendering the product under a wrong breadcrumb.
  if (!category || !subcategory || !product || product.category !== slug || product.subcategory !== subSlug) {
    notFound();
  }

  return <ProductDetail product={product} />;
}
