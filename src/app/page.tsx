import { Hero } from "@/components/home/Hero";
import { CategorySection } from "@/components/home/CategorySection";
import { BrandSection } from "@/components/home/BrandSection";
import { AboutPreview } from "@/components/site/AboutPreview";
import { PartnersSection } from "@/components/home/PartnersSection";

export default function Home() {
  return (
    <>
      <Hero />
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
