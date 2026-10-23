import Link from "next/link";
import { Reveal } from "@/components/motion/Reveal";
import { HoverBorderGrid } from "@/components/motion/HoverBorderGrid";
import { ProductGallery } from "@/components/catalog/ProductGallery";
import { ProductCard } from "@/components/catalog/ProductCard";
import { PtoNameplateGuide } from "@/components/catalog/PtoNameplateGuide";
import { CARD_GRID_GAP_CLASSNAME } from "@/lib/card-system";
import { cn } from "@/lib/utils";
import { getProducts } from "@/lib/queries/products";
import { getCategoryBrandSlugs } from "@/lib/queries/category-brands";
import { getDirectProductCategorySlugs } from "@/lib/queries/categories";
import { getVehicleTypes } from "@/lib/queries/vehicle-types";
import { getProductHref } from "@/lib/product-href";
import { preloadGalleryImages } from "@/lib/preload-gallery-images";
import type { Product } from "@/types/catalog";

// Shared product-detail render, used by both the subcategory-path and the
// brand-path product routes so the page looks identical regardless of which
// navigation route reached it. Every optional block (characteristics) is
// omitted entirely when its data is missing, so a partially-filled product
// never renders empty sections.
//
// Article, long description, brand "Совместимость" and the "Уточнить наличие"
// CTA are deliberately not rendered — the page shows title, short
// description, characteristics, the "Подходит для" vehicle-type pills, and
// photos. The underlying Product fields (article, description,
// compatibleBrands) and their admin inputs are untouched, so this is
// reversible without a data migration.
//
// No category/subcategory breadcrumb-style eyebrow here — the page's real
// Breadcrumb (in the shared layout) already shows that path, so repeating
// it here would just be duplicate noise above the title.
export async function ProductDetail({ product }: { product: Product }) {
  const relatedFilter = product.subcategory
    ? { categorySlug: product.category, subcategorySlug: product.subcategory }
    : { categorySlug: product.category, brandSlug: product.compatibleBrands[0] };
  const [relatedPage, categoryBrandSlugs, directProductCategorySlugs, allVehicleTypes] = await Promise.all([
    getProducts({ ...relatedFilter, pageSize: 5 }),
    getCategoryBrandSlugs(),
    getDirectProductCategorySlugs(),
    getVehicleTypes(),
  ]);
  const productVehicleTypes = allVehicleTypes.filter((vehicleType) => product.vehicleTypes.includes(vehicleType.slug));
  const relatedProducts = relatedPage.items.filter((item) => item.slug !== product.slug).slice(0, 4);
  preloadGalleryImages(product.images);

  return (
    <>
      <header className="mb-6 sm:mb-8">
        <h1 className="max-w-4xl text-balance text-3xl font-bold tracking-tight text-product-ink lg:text-4xl">{product.name}</h1>
        {product.shortDescription && <p className="mt-3 max-w-3xl text-pretty text-product-secondary">{product.shortDescription}</p>}
      </header>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-stretch lg:gap-10 xl:gap-14">
        <Reveal className="h-full">
          <ProductGallery images={product.images} alt={product.name} appearance="product" />
        </Reveal>

        <Reveal className="h-full">
          <section className="h-full lg:-translate-y-2" aria-labelledby="product-specs-title">
            <h2 id="product-specs-title" className="mb-4 text-xl font-semibold tracking-tight text-product-ink">
              Характеристики
            </h2>
            {product.characteristics && product.characteristics.length > 0 ? (
              <dl className="space-y-0.5">
                {product.characteristics.map((item, index) => (
                  <div
                    key={item.attribute}
                    className={cn(
                      "grid grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] items-center gap-x-3 rounded-lg px-3 py-2.5 text-sm leading-snug sm:gap-x-4 sm:px-4",
                      index % 2 === 0 && "bg-product-row"
                    )}
                  >
                    <dt className="font-medium text-product-secondary">{item.attribute}</dt>
                    <dd className="font-semibold text-product-ink tabular-nums">{item.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-product-secondary">Характеристики уточняются.</p>
            )}
          </section>
        </Reveal>
      </div>

      {productVehicleTypes.length > 0 && (
        <section className="mt-5 flex items-center gap-5 rounded-[20px] bg-product-surface p-4 shadow-product-card xl:mt-6" aria-labelledby="product-vehicle-types-title">
          <h2 id="product-vehicle-types-title" className="shrink-0 border-l-2 border-product-accent pl-3 text-product-body font-semibold text-product-ink">
            Подходит для
          </h2>
          <ul className="flex min-w-0 flex-1 flex-nowrap items-center gap-4 overflow-x-auto overscroll-x-contain whitespace-nowrap [scrollbar-width:thin]">
            {productVehicleTypes.map((vehicleType) => (
              <li key={vehicleType.slug} className="shrink-0">
                <Link
                  href={`/catalog/vehicle-type/${vehicleType.slug}`}
                  className="inline-flex min-h-11 items-center text-product-body font-medium text-product-accent underline decoration-product-accent/50 underline-offset-4 transition-colors duration-fast ease-ui hover:decoration-product-accent focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-product-accent focus-visible:ring-offset-2"
                >
                  {vehicleType.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {product.category === "pto" && <PtoNameplateGuide />}

      {relatedProducts.length > 0 && (
        <section className="mt-10 sm:mt-12" aria-labelledby="related-products-title">
          <h2 id="related-products-title" className="text-xl font-semibold text-product-ink">
            Похожие товары
          </h2>
          <HoverBorderGrid className="mt-6">
            <div className={cn("grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4", CARD_GRID_GAP_CLASSNAME)}>
              {relatedProducts.map((relatedProduct) => (
                <ProductCard
                  key={relatedProduct.slug}
                  product={relatedProduct}
                  href={getProductHref(relatedProduct, categoryBrandSlugs, directProductCategorySlugs)}
                  variant="product-detail"
                  deferImageLoading
                />
              ))}
            </div>
          </HoverBorderGrid>
        </section>
      )}
    </>
  );
}
