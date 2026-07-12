import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { brands } from "@/data/brands";

export function BrandSection() {
  return (
    <section id="brands" className="scroll-mt-16 bg-muted py-14 sm:py-16">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="Марки техники"
            title="Каталог по бренду техники"
            description="Найдите запчасти, совместимые с вашей маркой спецтехники."
          />
        </Reveal>
        <StaggerGroup className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {brands.map((brand) => (
            <StaggerItem key={brand.slug} hover>
              <Link
                href={`/catalog/brand/${brand.slug}`}
                className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card p-4 text-center transition-colors hover:border-blue-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <span className="flex h-12 w-full items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static local SVGs are already optimal; next/image blocks local SVGs without dangerouslyAllowSVG */}
                  <img
                    src={brand.logo}
                    alt={`Логотип ${brand.name}`}
                    className="max-h-12 max-w-[80%] object-contain"
                    style={brand.logoScale ? { transform: `scale(${brand.logoScale})` } : undefined}
                  />
                </span>
                <span className="text-sm font-semibold text-card-foreground">{brand.name}</span>
              </Link>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </Container>
    </section>
  );
}
