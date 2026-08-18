import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getCategories } from "@/lib/queries/categories";
import { getAllSubcategories } from "@/lib/queries/subcategories";
import { getBrands } from "@/lib/queries/brands";
import { getVehicleTypes } from "@/lib/queries/vehicle-types";
import { ProductForm } from "@/components/admin/ProductForm";
import { DEFAULT_PRODUCT_PHOTO_MODE, PRODUCT_PHOTO_MODE_COOKIE, isProductPhotoMode } from "@/lib/admin/product-photo-mode";

export const metadata: Metadata = {
  title: "Новый товар — Админка AYPROM",
};

export const revalidate = 0;

// Server Actions on this page (createProduct, when a script-processing
// photo mode is selected) can run the full enhance pipeline — several
// sequential sharp passes — across up to 10 photos. The platform default is
// well short of what that can take; this raises the ceiling for every
// Server Action on this route, not just the photo ones.
export const maxDuration = 60;

export default async function NewProductPage() {
  const [categories, subcategories, brands, vehicleTypes, cookieStore] = await Promise.all([
    getCategories(),
    getAllSubcategories(),
    getBrands(),
    getVehicleTypes(),
    cookies(),
  ]);
  const storedPhotoMode = cookieStore.get(PRODUCT_PHOTO_MODE_COOKIE)?.value;
  const initialPhotoMode = isProductPhotoMode(storedPhotoMode) ? storedPhotoMode : DEFAULT_PRODUCT_PHOTO_MODE;

  return (
    <ProductForm
      mode="create"
      categories={categories}
      subcategories={subcategories}
      brands={brands}
      vehicleTypes={vehicleTypes}
      initialPhotoMode={initialPhotoMode}
    />
  );
}
