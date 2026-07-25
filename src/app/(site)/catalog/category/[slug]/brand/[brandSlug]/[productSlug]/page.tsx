import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ProductDetail } from "@/components/catalog/ProductDetail";
import { StructuredData } from "@/components/seo/StructuredData";
import { getCategoryBrands } from "@/lib/queries/category-brands";
import { getProduct } from "@/lib/queries/products";
import { buildProductStructuredData } from "@/lib/product-structured-data";

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
  params: Promise<{ slug: string; brandSlug: string; productSlug: string }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug, brandSlug, productSlug } = await params;
  const product = await getProduct(productSlug);
  const canonical = `/catalog/category/${slug}/brand/${brandSlug}/${productSlug}`;
  return product
    ? {
        title: product.name,
        description: product.description || product.shortDescription,
        alternates: { canonical },
        openGraph: {
          type: "website",
          title: product.name,
          description: product.shortDescription,
          images: product.images[0]?.url ? [{ url: product.images[0].url, alt: product.name }] : undefined,
        },
      }
    : { title: "Товар", robots: { index: false } };
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

  const canonicalPath = `/catalog/category/${slug}/brand/${brandSlug}/${productSlug}`;
  return (
    <>
      <StructuredData data={buildProductStructuredData(product, canonicalPath)} />
      <ProductDetail product={product} />
    </>
  );
}
