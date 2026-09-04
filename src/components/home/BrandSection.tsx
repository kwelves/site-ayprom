import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { HoverBorderGrid } from "@/components/motion/HoverBorderGrid";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { getBrands } from "@/lib/queries/brands";
import type { Brand } from "@/types/catalog";

function BrandGrid({ brands }: { brands: Brand[] }) {
  return (
    <HoverBorderGrid className="mt-4">
      <StaggerGroup className="grid grid-cols-3 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
        {brands.map((brand) => (
          <StaggerItem key={brand.slug}>
            <Link
              href={`/catalog/brand/${brand.slug}`}
              data-hover-border-item
              className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-card-edge bg-card p-3 text-center transition-transform duration-fast ease-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.98] sm:gap-3 sm:p-4"
            >
              <span className="flex h-10 w-full items-center justify-center sm:h-12">
                {/* eslint-disable-next-line @next/next/no-img-element -- static local SVGs are already optimal; next/image blocks local SVGs without dangerouslyAllowSVG */}
                <img
                  src={brand.logo}
                  // Пустой alt: имя бренда уже дублируется видимым текстом
                  // ниже (см. комментарий в BrandCard.tsx — та же причина).
                  alt=""
                  width={160}
                  height={48}
                  className="max-h-10 max-w-[80%] object-contain sm:max-h-12"
                  style={brand.logoScale ? { transform: `scale(${brand.logoScale})` } : undefined}
                />
              </span>
              <span data-card-title className="text-xs font-semibold text-card-foreground sm:text-sm">
                {brand.name}
              </span>
            </Link>
          </StaggerItem>
        ))}
      </StaggerGroup>
    </HoverBorderGrid>
  );
}

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

        <BrandGrid brands={brands} />
      </Container>
    </section>
  );
}
