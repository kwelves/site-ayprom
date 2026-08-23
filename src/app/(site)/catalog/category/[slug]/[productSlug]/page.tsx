import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ProductDetail } from "@/components/catalog/ProductDetail";
import { CatalogPageShell } from "@/components/catalog/CatalogPageShell";
import { StructuredData } from "@/components/seo/StructuredData";
import { getCategory } from "@/lib/queries/categories";
import { getProduct } from "@/lib/queries/products";
import { categorySupportsDirectProducts } from "@/lib/category-routing";
import { buildProductStructuredData } from "@/lib/product-structured-data";

export const revalidate = 60;

// A dynamic segment without generateStaticParams renders fully dynamic on
// every request regardless of `revalidate` — same reasoning as the
// subcategory/brand product routes: an empty list still makes this
// ISR-eligible, each product page renders on first visit and is cached
// after that.
export async function generateStaticParams() {
  return [];
}

interface ProductPageProps {
  params: Promise<{ slug: string; productSlug: string }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug, productSlug } = await params;
  const product = await getProduct(productSlug);
  const canonical = `/catalog/category/${slug}/${productSlug}`;
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

// Products without a subcategory link straight here. This covers both flat
// categories and mixed subcategory categories; brand categories still use
// their /brand/[brandSlug]/ route.
export default async function DirectCategoryProductPage({ params }: ProductPageProps) {
  const { slug, productSlug } = await params;
  const [category, product] = await Promise.all([getCategory(slug), getProduct(productSlug)]);

  // A mismatched category, brand-only category or subcategorized product
  // still 404s instead of rendering under the wrong breadcrumb.
  if (
    !category ||
    !categorySupportsDirectProducts(category.type) ||
    !product ||
    product.category !== slug ||
    product.subcategory
  ) {
    notFound();
  }

  const canonicalPath = `/catalog/category/${slug}/${productSlug}`;
  return (
    <CatalogPageShell
      items={[
        { label: category.name, href: `/catalog/category/${slug}` },
        { label: product.name },
      ]}
    >
      <StructuredData data={buildProductStructuredData(product, canonicalPath)} />
      <ProductDetail product={product} />
    </CatalogPageShell>
  );
}
