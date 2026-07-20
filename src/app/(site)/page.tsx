import { Hero } from "@/components/home/Hero";
import { CategorySection } from "@/components/home/CategorySection";
import { BrandSection } from "@/components/home/BrandSection";
import { AboutPreview } from "@/components/site/AboutPreview";
import { PartnersSection } from "@/components/home/PartnersSection";
import { getVehicleTypes } from "@/lib/queries/vehicle-types";

export const revalidate = 60;

export default async function Home() {
  const vehicleTypes = await getVehicleTypes();

  return (
    <>
      <Hero vehicleTypes={vehicleTypes} />
      {/* Opaque backdrop so sections cover the fixed hero photo while scrolling */}
      <div className="relative bg-background">
        <CategorySection />
        <BrandSection />
        <AboutPreview />
        <PartnersSection />
      </div>
    </>
  );
}
