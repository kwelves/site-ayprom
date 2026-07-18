import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAdminCategory } from "@/lib/admin/queries";
import { SubcategoryForm } from "@/components/admin/SubcategoryForm";

export const metadata: Metadata = {
  title: "Новая подкатегория — Админка AYPROM",
};

interface NewSubcategoryPageProps {
  params: Promise<{ slug: string }>;
}

export default async function NewSubcategoryPage({ params }: NewSubcategoryPageProps) {
  const { slug } = await params;
  const category = await getAdminCategory(slug);
  if (!category) {
    notFound();
  }

  return <SubcategoryForm mode="create" categorySlug={slug} categoryName={category.name} />;
}
