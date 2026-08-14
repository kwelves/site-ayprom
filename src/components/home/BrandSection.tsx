import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { BrandHoverGrid } from "@/components/home/BrandHoverGrid";
import { getBrands } from "@/lib/queries/brands";

export async function BrandSection() {
  const brands = await getBrands();

  return (
    <section id="brands" className="scroll-mt-16 py-14 sm:py-16">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="Марки техники"
            title="Каталог по бренду техники"
            description="Найдите запчасти, совместимые с вашей маркой спецтехники."
          />
        </Reveal>

        <BrandHoverGrid brands={brands} />
      </Container>
    </section>
  );
}
