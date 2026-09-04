import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Reveal } from "@/components/motion/Reveal";
import { HoverBorderGrid } from "@/components/motion/HoverBorderGrid";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { CategoryCard } from "@/components/home/CategoryCard";
import { CatalogPageShell } from "@/components/catalog/CatalogPageShell";
import { getBrand, getBrands } from "@/lib/queries/brands";
import { getBrandCategories } from "@/lib/queries/categories";
import { getCardGridSizing } from "@/lib/category-grid";
import { getBrandSeo } from "@/lib/brand-seo";
import { cn } from "@/lib/utils";
import type { Brand } from "@/types/catalog";

export const revalidate = 60;

// See catalog/category/[slug]'s generateStaticParams comment — same reasoning.
export async function generateStaticParams() {
  const brands = await getBrands();
  return brands.map((brand) => ({ slug: brand.slug }));
}

interface BrandPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: BrandPageProps): Promise<Metadata> {
  const { slug } = await params;
  const brand = await getBrand(slug);
  if (!brand) return { title: "Каталог", robots: { index: false } };

  const seo = getBrandSeo(slug);
  return {
    title: seo?.title ?? brand.name,
    description: seo?.description ?? `Каталог гидрооборудования и запчастей, совместимых с техникой ${brand.name}.`,
    alternates: { canonical: `/catalog/brand/${slug}` },
  };
}

function BrandHeader({ brand }: { brand: Brand }) {
  return (
    <Reveal>
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <span className="flex h-16 w-32 items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- static local SVGs are already optimal; next/image blocks local SVGs without dangerouslyAllowSVG */}
          <img
            src={brand.logo}
            alt={`Логотип ${brand.name}`}
            width={128}
            height={64}
            className="max-h-full max-w-full object-contain"
            style={brand.logoScale ? { transform: `scale(${brand.logoScale})` } : undefined}
          />
        </span>
        {/* Visually hidden — the logo above already identifies the brand
            on screen, but the page still needs a real text heading for
            SEO and screen readers. */}
        <h1 className="sr-only">{brand.name}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{brand.country}</p>
      </div>
    </Reveal>
  );
}

export default async function BrandPage({ params }: BrandPageProps) {
  const { slug } = await params;
  const brand = await getBrand(slug);

  if (!brand) {
    notFound();
  }

  const categories = await getBrandCategories(slug);
  const sizing = getCardGridSizing(categories.length);
  const seo = getBrandSeo(slug);

  return (
    <CatalogPageShell canonicalPath={`/catalog/brand/${slug}`} items={[{ label: brand.name }]}>
      <BrandHeader brand={brand} />

      {categories.length === 0 ? (
        <p className="mx-auto mt-8 max-w-2xl text-center text-muted-foreground">
          У бренда «{brand.name}» пока нет товаров. Скоро они здесь появятся.
        </p>
      ) : (
        <>
          <Reveal>
            <p className="mx-auto mt-6 max-w-2xl text-center text-muted-foreground">
              Выберите категорию, чтобы найти запчасти для «{brand.name}».
            </p>
          </Reveal>
          <HoverBorderGrid className={cn("mt-8", sizing.containerClassName)}>
            <StaggerGroup className="flex flex-wrap justify-center gap-5">
              {categories.map((category) => (
                <StaggerItem key={category.slug} className={sizing.itemClassName}>
                  <CategoryCard
                    href={
                      category.type === "brand"
                        ? `/catalog/category/${category.slug}/brand/${slug}`
                        : `/catalog/brand/${slug}/category/${category.slug}`
                    }
                    image={category.image}
                    name={category.name}
                  />
                </StaggerItem>
              ))}
            </StaggerGroup>
          </HoverBorderGrid>
        </>
      )}

      {seo && (
        <Reveal>
          <p className="mx-auto mt-14 max-w-2xl text-center text-muted-foreground">{seo.intro}</p>
        </Reveal>
      )}
    </CatalogPageShell>
  );
}
