import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ProductDetail } from "@/components/catalog/ProductDetail";
import { getSubcategory } from "@/lib/queries/subcategories";
import { getProduct } from "@/lib/queries/products";

export const revalidate = 60;

// A dynamic segment without generateStaticParams renders fully dynamic on
// every request regardless of `revalidate`. Not enumerating every product
// here on purpose (catalog is scaling toward thousands of rows) — an empty
// list still makes the route ISR-eligible: each product page is rendered on
// its first visit and then cached for `revalidate` seconds.
export async function generateStaticParams() {
  return [];
}

interface ProductPageProps {
  params: Promise<{ slug: string; subSlug: string; productSlug: string }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { productSlug } = await params;
  const product = await getProduct(productSlug);
  return { title: product ? `${product.name} — AYPROM` : "Товар — AYPROM" };
}

export default async function SubcategoryProductPage({ params }: ProductPageProps) {
  const { slug, subSlug, productSlug } = await params;
  const [subcategory, product] = await Promise.all([getSubcategory(slug, subSlug), getProduct(productSlug)]);

  // The product must actually belong to this exact category + subcategory —
  // otherwise a mismatched path (e.g. a pump under a tanks URL) 404s instead
  // of rendering the product under a wrong breadcrumb.
  if (!subcategory || !product || product.category !== slug || product.subcategory !== subSlug) {
    notFound();
  }

  return <ProductDetail product={product} />;
}
