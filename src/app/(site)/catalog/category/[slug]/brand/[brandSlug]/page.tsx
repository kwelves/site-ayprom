import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Reveal } from "@/components/motion/Reveal";
import { ProductSearchForm } from "@/components/catalog/ProductSearchForm";
import { ProductGridWithSearch } from "@/components/catalog/ProductGridWithSearch";
import { getCategory } from "@/lib/queries/categories";
import { getCategoryBrands } from "@/lib/queries/category-brands";
import { getProducts } from "@/lib/queries/products";

export const revalidate = 0;

interface BrandInCategoryPageProps {
  params: Promise<{ slug: string; brandSlug: string }>;
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({ params }: BrandInCategoryPageProps): Promise<Metadata> {
  const { slug, brandSlug } = await params;
  const [category, categoryBrands] = await Promise.all([getCategory(slug), getCategoryBrands(slug)]);
  const brand = categoryBrands.find((item) => item.slug === brandSlug);
  return { title: category && brand ? `${category.name} — ${brand.name} — AYPROM` : "Каталог — AYPROM" };
}

export default async function BrandInCategoryPage({ params, searchParams }: BrandInCategoryPageProps) {
  const { slug, brandSlug } = await params;
  const { q } = await searchParams;
  const [category, categoryBrands] = await Promise.all([getCategory(slug), getCategoryBrands(slug)]);
  const brand = categoryBrands.find((item) => item.slug === brandSlug);

  if (!category || !brand) {
    notFound();
  }

  const brandProducts = await getProducts({ categorySlug: slug, brandSlug });

  return (
    <>
      <Reveal>
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">{category.name}</p>
          <span className="mt-3 flex h-16 w-32 items-center justify-center">
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
          <h2 className="sr-only">{brand.name}</h2>
        </div>
      </Reveal>

      <div className="mt-6">
        <ProductSearchForm
          action={`/catalog/category/${slug}/brand/${brandSlug}`}
          defaultValue={q}
          placeholder={
            brand.relation === "from" ? `Поиск по товарам от «${brand.name}»` : `Поиск по «${brand.name}»`
          }
        />
      </div>

      <ProductGridWithSearch
        products={brandProducts}
        query={q}
        scopeLabel={brand.relation === "from" ? `от бренда «${brand.name}»` : `для бренда «${brand.name}»`}
        href={(product) => `/catalog/category/${slug}/brand/${brandSlug}/${product.slug}`}
        emptyLabel={
          brand.relation === "from"
            ? "От этого бренда пока нет товаров. Скоро они здесь появятся."
            : "Для этого бренда пока нет товаров. Скоро они здесь появятся."
        }
      />
    </>
  );
}
