import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAdminCategory, getAdminSubcategory } from "@/lib/admin/queries";
import { SubcategoryForm } from "@/components/admin/SubcategoryForm";

export const revalidate = 0;

interface EditSubcategoryPageProps {
  params: Promise<{ slug: string; subSlug: string }>;
}

export async function generateMetadata({ params }: EditSubcategoryPageProps): Promise<Metadata> {
  const { slug, subSlug } = await params;
  // The record's own name, not its address: the admin keeps fetched data in memory, so the page reuses this read.
  const subcategory = await getAdminSubcategory(slug, subSlug);
  return { title: `Подкатегория «${subcategory?.name ?? subSlug}» — Админка AYPROM` };
}

export default async function EditSubcategoryPage({ params }: EditSubcategoryPageProps) {
  const { slug, subSlug } = await params;
  const [category, subcategory] = await Promise.all([getAdminCategory(slug), getAdminSubcategory(slug, subSlug)]);

  if (!category || !subcategory) {
    notFound();
  }

  return <SubcategoryForm mode="edit" categorySlug={slug} categoryName={category.name} subcategory={subcategory} />;
}
