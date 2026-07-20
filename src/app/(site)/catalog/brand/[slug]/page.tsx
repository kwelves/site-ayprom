import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Reveal } from "@/components/motion/Reveal";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { CategoryCard } from "@/components/home/CategoryCard";
import { getBrand, getBrands } from "@/lib/queries/brands";
import { getBrandCategories } from "@/lib/queries/categories";
import { getCardGridSizing } from "@/lib/category-grid";
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
  return { title: brand ? `${brand.name} — AYPROM` : "Каталог — AYPROM" };
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

  return (
    <>
      <BrandHeader brand={brand} />

      {categories.length === 0 ? (
        <p className="mx-auto mt-8 max-w-2xl text-center text-slate-600">
          У бренда «{brand.name}» пока нет товаров. Скоро они здесь появятся.
        </p>
      ) : (
        <>
          <Reveal>
            <p className="mx-auto mt-6 max-w-2xl text-center text-slate-600">
              Выберите категорию, чтобы найти запчасти для «{brand.name}».
            </p>
          </Reveal>
          <StaggerGroup className={cn("mt-8 flex flex-wrap justify-center gap-5", sizing.containerClassName)}>
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
        </>
      )}
    </>
  );
}
