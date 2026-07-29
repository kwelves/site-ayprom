import type { Metadata } from "next";
import { Hero } from "@/components/home/Hero";
import { CategorySection } from "@/components/home/CategorySection";
import { VehicleShowcaseSection } from "@/components/home/VehicleShowcaseSection";
import { BrandSection } from "@/components/home/BrandSection";
import { AboutPreview } from "@/components/site/AboutPreview";
import { PartnersSection } from "@/components/home/PartnersSection";
import { getVehicleTypes } from "@/lib/queries/vehicle-types";
import { getCategories } from "@/lib/queries/categories";

export const revalidate = 60;
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default async function Home() {
  const [vehicleTypes, categories] = await Promise.all([getVehicleTypes(), getCategories()]);

  return (
    <>
      <Hero vehicleTypes={vehicleTypes} categories={categories} />
      {/* Opaque backdrop so sections cover the fixed hero photo while scrolling */}
      <div className="relative bg-background">
        <CategorySection />
        <VehicleShowcaseSection />
        <BrandSection />
        <AboutPreview />
        <PartnersSection />
      </div>
    </>
  );
}
