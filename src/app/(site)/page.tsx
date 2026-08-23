import type { Metadata } from "next";
import { Hero } from "@/components/home/Hero";
import { CategorySection } from "@/components/home/CategorySection";
import { VehicleShowcaseSection } from "@/components/home/VehicleShowcaseSection";
import { BrandSection } from "@/components/home/BrandSection";
import { AboutPreview } from "@/components/site/AboutPreview";
import { PartnersSection } from "@/components/home/PartnersSection";
import { getVehicleTypes } from "@/lib/queries/vehicle-types";
import { HomeEntryContent } from "@/components/home/HomeEntrySequence";

// Временно скрыто до появления реальных логотипов/кейсов партнёров.
// Вернуть секцию можно одним переключением без восстановления удалённого UI.
const SHOW_PARTNERS_SECTION = false;

export const revalidate = 60;
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default async function Home() {
  const vehicleTypes = await getVehicleTypes();

  return (
    <>
      <Hero vehicleTypes={vehicleTypes} />
      {/* Opaque backdrop so sections cover the fixed hero photo while scrolling */}
      <HomeEntryContent className="relative bg-background">
        <VehicleShowcaseSection />
        <CategorySection />
        <BrandSection />
        <AboutPreview />
        {SHOW_PARTNERS_SECTION && <PartnersSection />}
      </HomeEntryContent>
    </>
  );
}
