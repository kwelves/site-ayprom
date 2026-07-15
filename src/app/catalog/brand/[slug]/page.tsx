import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Reveal } from "@/components/motion/Reveal";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { ProductCard } from "@/components/catalog/ProductCard";
import { brands } from "@/data/brands";
import { products } from "@/data/products";
import { getProductHref } from "@/lib/product-href";

interface BrandPageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return brands.map((brand) => ({ slug: brand.slug }));
}

export async function generateMetadata({ params }: BrandPageProps): Promise<Metadata> {
  const { slug } = await params;
  const brand = brands.find((item) => item.slug === slug);
  return { title: brand ? `${brand.name} — AYPROM` : "Каталог — AYPROM" };
}

export default async function BrandPage({ params }: BrandPageProps) {
  const { slug } = await params;
  const brand = brands.find((item) => item.slug === slug);

  if (!brand) {
    notFound();
  }

  // Every category (not just the brand-type ones) can carry compatibleBrands
  // — this page is the brand-wide view across all of them, unlike
  // /catalog/category/[slug]/brand/[brandSlug] which stays inside one category.
  const brandProducts = products.filter((product) => product.compatibleBrands.includes(slug));

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
          <h1 className="mt-3 text-2xl font-bold text-foreground sm:text-3xl">{brand.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{brand.country}</p>
        </div>
      </Reveal>

      {brandProducts.length > 0 ? (
        <StaggerGroup className="mt-10 grid grid-cols-2 gap-5 lg:grid-cols-4">
          {brandProducts.map((product) => (
            <StaggerItem key={product.slug}>
              <ProductCard product={product} href={getProductHref(product)} />
            </StaggerItem>
          ))}
        </StaggerGroup>
      ) : (
        <p className="mt-10 text-center text-slate-600">
          Для бренда «{brand.name}» пока нет товаров. Скоро они здесь появятся.
        </p>
      )}
    </>
  );
}
