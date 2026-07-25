import { notFound, permanentRedirect } from "next/navigation";
import { getCategoryBrandSlugs } from "@/lib/queries/category-brands";
import { getProduct } from "@/lib/queries/products";
import { getProductHref } from "@/lib/product-href";

export const revalidate = 60;

export default async function ProductRedirectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [product, categoryBrandSlugs] = await Promise.all([getProduct(slug), getCategoryBrandSlugs()]);

  if (!product) notFound();
  permanentRedirect(getProductHref(product, categoryBrandSlugs));
}
