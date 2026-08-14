import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { getBrands } from "@/lib/queries/brands";
import type { Brand } from "@/types/catalog";

// Лёгкая едущая лента логотипов вместо ещё одной сетки карточек — на главной
// и так три блока подряд строятся по схеме "заголовок + сетка"
// (VehicleShowcase, Category, About), у брендов другая форма.
function BrandMarquee({ brands }: { brands: Brand[] }) {
  // Список задублирован, а лента едет ровно на -50% своей ширины — стык
  // между концом первой копии и началом второй не виден.
  const track = [...brands, ...brands];

  return (
    <div className="mt-8 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
      <div className="flex w-max animate-marquee items-center gap-10 hover:[animation-play-state:paused] focus-within:[animation-play-state:paused] sm:gap-14">
        {track.map((brand, index) => {
          // Вторая копия дублирует ссылки только визуально (для бесшовной
          // петли) — из таба и скринридера она исключена, иначе получаются
          // копии одних и тех же ссылок на странице.
          const isDuplicate = index >= brands.length;

          return (
            <Link
              key={`${brand.slug}-${index}`}
              href={`/catalog/brand/${brand.slug}`}
              aria-hidden={isDuplicate}
              tabIndex={isDuplicate ? -1 : undefined}
              className="flex shrink-0 items-center opacity-60 grayscale transition-[opacity,filter] duration-fast ease-ui hover:opacity-100 hover:grayscale-0 focus-visible:opacity-100 focus-visible:grayscale-0 focus-visible:outline-none"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- static local SVGs are already optimal; next/image blocks local SVGs without dangerouslyAllowSVG */}
              <img
                src={brand.logo}
                alt={`Логотип ${brand.name}`}
                width={120}
                height={40}
                className="h-8 w-auto max-w-[120px] object-contain sm:h-9"
                style={brand.logoScale ? { transform: `scale(${brand.logoScale})` } : undefined}
              />
            </Link>
          );
        })}
      </div>
    </div>
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
      </Container>

      <BrandMarquee brands={brands} />
    </section>
  );
}
