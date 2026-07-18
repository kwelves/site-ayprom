import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Reveal } from "@/components/motion/Reveal";
import { ProductSearchForm } from "@/components/catalog/ProductSearchForm";
import { ProductGridWithSearch } from "@/components/catalog/ProductGridWithSearch";
import { getBrand } from "@/lib/queries/brands";
import { getProducts } from "@/lib/queries/products";
import { getCategoryBrandSlugs } from "@/lib/queries/category-brands";
import { getProductHref } from "@/lib/product-href";

export const revalidate = 0;

interface BrandPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({ params }: BrandPageProps): Promise<Metadata> {
  const { slug } = await params;
  const brand = await getBrand(slug);
  return { title: brand ? `${brand.name} — AYPROM` : "Каталог — AYPROM" };
}

export default async function BrandPage({ params, searchParams }: BrandPageProps) {
  const { slug } = await params;
  const { q } = await searchParams;
  const brand = await getBrand(slug);

  if (!brand) {
    notFound();
  }

  // Every category (not just the brand-type ones) can carry compatibleBrands
  // — this page is the brand-wide view across all of them, unlike
  // /catalog/category/[slug]/brand/[brandSlug] which stays inside one category.
  const [brandProducts, categoryBrandSlugs] = await Promise.all([
    getProducts({ brandSlug: slug }),
    getCategoryBrandSlugs(),
  ]);

  return (
    <>
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

      <div className="mt-6">
        <ProductSearchForm
          action={`/catalog/brand/${slug}`}
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
        href={(product) => getProductHref(product, categoryBrandSlugs)}
        emptyLabel={
          brand.relation === "from"
            ? `От бренда «${brand.name}» пока нет товаров. Скоро они здесь появятся.`
            : `Для бренда «${brand.name}» пока нет товаров. Скоро они здесь появятся.`
        }
      />
    </>
  );
}
