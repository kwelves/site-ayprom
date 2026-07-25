import Link from "next/link";
import { Reveal } from "@/components/motion/Reveal";
import { ProductGallery } from "@/components/catalog/ProductGallery";
import { ProductCard } from "@/components/catalog/ProductCard";
import { getBrands } from "@/lib/queries/brands";
import { getVehicleTypes } from "@/lib/queries/vehicle-types";
import { getProducts } from "@/lib/queries/products";
import { getCategoryBrandSlugs } from "@/lib/queries/category-brands";
import { getProductHref } from "@/lib/product-href";
import type { Product } from "@/types/catalog";

// Shared product-detail render, used by both the subcategory-path and the
// brand-path product routes so the page looks identical regardless of which
// navigation route reached it. Every optional block (description,
// characteristics, compatible brands) is omitted entirely when its data is
// missing, so a partially-filled product never renders empty sections.
//
// No category/subcategory breadcrumb-style eyebrow here — the page's real
// Breadcrumb (in the shared layout) already shows that path, so repeating
// it here would just be duplicate noise above the title.
export async function ProductDetail({ product }: { product: Product }) {
  const relatedFilter = product.subcategory
    ? { categorySlug: product.category, subcategorySlug: product.subcategory }
    : { categorySlug: product.category, brandSlug: product.compatibleBrands[0] };
  const [brands, vehicleTypes, relatedPage, categoryBrandSlugs] = await Promise.all([
    getBrands(),
    getVehicleTypes(),
    getProducts({ ...relatedFilter, pageSize: 5 }),
    getCategoryBrandSlugs(),
  ]);
  const compatibleBrands = product.compatibleBrands
    .map((brandSlug) => brands.find((brand) => brand.slug === brandSlug))
    .filter((brand): brand is NonNullable<typeof brand> => Boolean(brand));
  const productVehicleTypes = product.vehicleTypes
    .map((vehicleTypeSlug) => vehicleTypes.find((vehicleType) => vehicleType.slug === vehicleTypeSlug))
    .filter((vehicleType): vehicleType is NonNullable<typeof vehicleType> => Boolean(vehicleType));
  const relatedProducts = relatedPage.items.filter((item) => item.slug !== product.slug).slice(0, 4);
  const inquirySubject = encodeURIComponent(`Уточнить наличие: ${product.name}`);
  const inquiryBody = encodeURIComponent(
    `Здравствуйте! Подскажите, пожалуйста, наличие товара «${product.name}»${product.article ? `, артикул ${product.article}` : ""}.`,
  );

  return (
    <>
      <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
        <Reveal>
          <ProductGallery images={product.images} alt={product.name} />
        </Reveal>

        <Reveal>
          <div>
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{product.name}</h1>
            <p className="mt-2 text-sm font-medium text-primary">
              Артикул: {product.article || "уточняется"}
            </p>
            <p className="mt-3 text-slate-600">{product.shortDescription}</p>

            {product.description && <p className="mt-6 text-sm leading-relaxed text-slate-600">{product.description}</p>}

            <div className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Характеристики
              </h2>
              {product.characteristics && product.characteristics.length > 0 ? (
                <dl className="mt-3 divide-y divide-border">
                  {product.characteristics.map((item) => (
                    <div key={item.attribute} className="flex justify-between gap-4 py-2 text-sm">
                      <dt className="text-slate-600">{item.attribute}</dt>
                      <dd className="font-medium text-card-foreground">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">Характеристики уточняются.</p>
              )}
            </div>

            {productVehicleTypes.length > 0 && (
              <div className="mt-6">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Подходит для</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {productVehicleTypes.map((vehicleType) => (
                    <Link
                      key={vehicleType.slug}
                      href={`/catalog/vehicle-type/${vehicleType.slug}`}
                      className="rounded-full border border-border bg-card px-3 py-2 text-sm text-card-foreground transition-colors hover:border-blue-300"
                    >
                      {vehicleType.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Совместимость
              </h2>
              {compatibleBrands.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {compatibleBrands.map((brand) => (
                    <Link
                      key={brand.slug}
                      href={`/catalog/brand/${brand.slug}`}
                      className="rounded-full border border-border bg-card px-3 py-2 text-sm text-card-foreground transition-colors hover:border-blue-300"
                    >
                      {brand.name}
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">Совместимость уточняется у менеджера.</p>
              )}
            </div>

            <a
              href={`mailto:info@ayprom.kg?subject=${inquirySubject}&body=${inquiryBody}`}
              className="mt-8 inline-flex rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-blue-700"
            >
              Уточнить наличие
            </a>
          </div>
        </Reveal>
      </div>

      {relatedProducts.length > 0 && (
        <section className="mt-16 border-t border-border pt-10" aria-labelledby="related-products-title">
          <h2 id="related-products-title" className="text-xl font-semibold text-foreground">
            Похожие товары
          </h2>
          <div className="mt-6 grid grid-cols-2 gap-5 lg:grid-cols-4">
            {relatedProducts.map((relatedProduct) => (
              <ProductCard
                key={relatedProduct.slug}
                product={relatedProduct}
                href={getProductHref(relatedProduct, categoryBrandSlugs)}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
