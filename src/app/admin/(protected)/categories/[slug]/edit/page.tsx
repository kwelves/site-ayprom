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
  // The record's own name, not its address: the admin keeps fetched data in memory, so the page reuses this read.
  const category = await getAdminCategory(slug);
  return { title: `Категория «${category?.name ?? slug}» — Админка AYPROM` };
}

export default async function EditCategoryPage({ params }: EditCategoryPageProps) {
  const { slug } = await params;
  const category = await getAdminCategory(slug);

  if (!category) {
    notFound();
  }

  return <CategoryForm mode="edit" category={category} />;
}
