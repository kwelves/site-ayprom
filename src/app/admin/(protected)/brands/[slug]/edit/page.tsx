import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAdminBrand } from "@/lib/admin/queries";
import { BrandForm } from "@/components/admin/BrandForm";

export const revalidate = 0;

interface EditBrandPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: EditBrandPageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Редактировать бренд «${slug}» — Админка AYPROM` };
}

export default async function EditBrandPage({ params }: EditBrandPageProps) {
  const { slug } = await params;
  const brand = await getAdminBrand(slug);

  if (!brand) {
    notFound();
  }

  return <BrandForm mode="edit" brand={brand} />;
}
