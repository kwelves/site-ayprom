import type { Metadata } from "next";
import { getCategories } from "@/lib/queries/categories";
import { getAllSubcategories } from "@/lib/queries/subcategories";
import { getBrands } from "@/lib/queries/brands";
import { getVehicleTypes } from "@/lib/queries/vehicle-types";
import { ProductForm } from "@/components/admin/ProductForm";

export const metadata: Metadata = {
  title: "Новый товар — Админка AYPROM",
};

export const revalidate = 0;

export default async function NewProductPage() {
  const [categories, subcategories, brands, vehicleTypes] = await Promise.all([
    getCategories(),
    getAllSubcategories(),
    getBrands(),
    getVehicleTypes(),
  ]);

  return (
    <ProductForm
      mode="create"
      categories={categories}
      subcategories={subcategories}
      brands={brands}
      vehicleTypes={vehicleTypes}
    />
  );
}
