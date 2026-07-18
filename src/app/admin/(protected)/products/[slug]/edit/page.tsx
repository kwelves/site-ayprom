import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAdminProduct } from "@/lib/admin/queries";
import { getCategories } from "@/lib/queries/categories";
import { getAllSubcategories } from "@/lib/queries/subcategories";
import { getBrands } from "@/lib/queries/brands";
import { ProductForm } from "@/components/admin/ProductForm";

export const revalidate = 0;

interface EditProductPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: EditProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Редактировать товар «${slug}» — Админка AYPROM` };
}

export default async function EditProductPage({ params }: EditProductPageProps) {
  const { slug } = await params;
  const [product, categories, subcategories, brands] = await Promise.all([
    getAdminProduct(slug),
    getCategories(),
    getAllSubcategories(),
    getBrands(),
  ]);

  if (!product) {
    notFound();
  }

  return (
    <ProductForm mode="edit" product={product} categories={categories} subcategories={subcategories} brands={brands} />
  );
}
