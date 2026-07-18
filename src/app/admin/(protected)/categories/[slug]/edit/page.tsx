import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAdminCategory } from "@/lib/admin/queries";
import { CategoryForm } from "@/components/admin/CategoryForm";

export const revalidate = 0;

interface EditCategoryPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: EditCategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Редактировать категорию «${slug}» — Админка AYPROM` };
}

export default async function EditCategoryPage({ params }: EditCategoryPageProps) {
  const { slug } = await params;
  const category = await getAdminCategory(slug);

  if (!category) {
    notFound();
  }

  return <CategoryForm mode="edit" category={category} />;
}
