import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ProductDetail } from "@/components/catalog/ProductDetail";
import { CatalogPageShell } from "@/components/catalog/CatalogPageShell";
import { getCategory } from "@/lib/queries/categories";
import { getSubcategory } from "@/lib/queries/subcategories";
import { getProduct } from "@/lib/queries/products";
import { buildProductMetadata, MISSING_PRODUCT_METADATA } from "@/lib/product-metadata";

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
  const { slug, subSlug, productSlug } = await params;
  const product = await getProduct(productSlug);
  const canonical = `/catalog/category/${slug}/subcategory/${subSlug}/${productSlug}`;
  return product ? buildProductMetadata(product, canonical) : MISSING_PRODUCT_METADATA;
}

export default async function SubcategoryProductPage({ params }: ProductPageProps) {
  const { slug, subSlug, productSlug } = await params;
  const [category, subcategory, product] = await Promise.all([
    getCategory(slug),
    getSubcategory(slug, subSlug),
    getProduct(productSlug),
  ]);

  // The product must actually belong to this exact category + subcategory —
  // otherwise a mismatched path (e.g. a pump under a tanks URL) 404s instead
  // of rendering the product under a wrong breadcrumb.
  if (!category || !subcategory || !product || product.category !== slug || product.subcategory !== subSlug) {
    notFound();
  }

  const canonicalPath = `/catalog/category/${slug}/subcategory/${subSlug}/${productSlug}`;
  return (
    <CatalogPageShell
      canonicalPath={canonicalPath}
      items={[
        { label: category.name, href: `/catalog/category/${slug}` },
        { label: subcategory.name, href: `/catalog/category/${slug}/subcategory/${subSlug}` },
        { label: product.name },
      ]}
    >
      <ProductDetail product={product} />
    </CatalogPageShell>
  );
}
