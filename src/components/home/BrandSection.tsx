import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { getBrands } from "@/lib/queries/brands";
import type { Brand } from "@/types/catalog";

function BrandGrid({ brands }: { brands: Brand[] }) {
  return (
    <StaggerGroup className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
      {brands.map((brand) => (
        <StaggerItem key={brand.slug} hover>
          <Link
            href={`/catalog/brand/${brand.slug}`}
            className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card p-3 text-center transition-colors hover:border-blue-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:gap-3 sm:p-4"
          >
            <span className="flex h-10 w-full items-center justify-center sm:h-12">
              {/* eslint-disable-next-line @next/next/no-img-element -- static local SVGs are already optimal; next/image blocks local SVGs without dangerouslyAllowSVG */}
              <img
                src={brand.logo}
                alt={`Логотип ${brand.name}`}
                className="max-h-10 max-w-[80%] object-contain sm:max-h-12"
                style={brand.logoScale ? { transform: `scale(${brand.logoScale})` } : undefined}
              />
            </span>
            <span className="text-xs font-semibold text-card-foreground sm:text-sm">{brand.name}</span>
          </Link>
        </StaggerItem>
      ))}
    </StaggerGroup>
  );
}

export async function BrandSection() {
  const brands = await getBrands();
  const forBrands = brands.filter((brand) => brand.relation === "for");
  const fromBrands = brands.filter((brand) => brand.relation === "from");
  // Only split into labeled groups when there's something on both sides to
  // contrast — a lone group (e.g. no "от" brands yet) just renders as one
  // plain grid, same convention as the product-page brand split.
  const showSplit = forBrands.length > 0 && fromBrands.length > 0;

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

        {showSplit ? (
          <>
            <p className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Для бренда
            </p>
            <BrandGrid brands={forBrands} />

            <p className="mt-10 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              От бренда
            </p>
            <BrandGrid brands={fromBrands} />
          </>
        ) : (
          <BrandGrid brands={brands} />
        )}
      </Container>
    </section>
  );
}
