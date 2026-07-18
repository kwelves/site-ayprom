import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAdminCategory, getAdminSubcategory } from "@/lib/admin/queries";
import { SubcategoryForm } from "@/components/admin/SubcategoryForm";

export const revalidate = 0;

interface EditSubcategoryPageProps {
  params: Promise<{ slug: string; subSlug: string }>;
}

export async function generateMetadata({ params }: EditSubcategoryPageProps): Promise<Metadata> {
  const { subSlug } = await params;
  return { title: `Редактировать подкатегорию «${subSlug}» — Админка AYPROM` };
}

export default async function EditSubcategoryPage({ params }: EditSubcategoryPageProps) {
  const { slug, subSlug } = await params;
  const [category, subcategory] = await Promise.all([getAdminCategory(slug), getAdminSubcategory(slug, subSlug)]);

  if (!category || !subcategory) {
    notFound();
  }

  return <SubcategoryForm mode="edit" categorySlug={slug} categoryName={category.name} subcategory={subcategory} />;
}
