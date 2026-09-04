import { Reveal } from "@/components/motion/Reveal";
import { HoverBorderGrid } from "@/components/motion/HoverBorderGrid";
import { ProductGallery } from "@/components/catalog/ProductGallery";
import { ProductCard } from "@/components/catalog/ProductCard";
import { PtoNameplateGuide } from "@/components/catalog/PtoNameplateGuide";
import { getProducts } from "@/lib/queries/products";
import { getCategoryBrandSlugs } from "@/lib/queries/category-brands";
import { getDirectProductCategorySlugs } from "@/lib/queries/categories";
import { getProductHref } from "@/lib/product-href";
import type { Product } from "@/types/catalog";

// Shared product-detail render, used by both the subcategory-path and the
// brand-path product routes so the page looks identical regardless of which
// navigation route reached it. Every optional block (characteristics) is
// omitted entirely when its data is missing, so a partially-filled product
// never renders empty sections.
//
// Article, long description, "Подходит для"/"Совместимость" and the
// "Уточнить наличие" CTA are deliberately not rendered — v1 shows title,
// short description, characteristics, and photos only. The underlying
// Product fields (article, description, compatibleBrands, vehicleTypes)
// and their admin inputs are untouched, so this is reversible without a
// data migration whenever a later version wants them back.
//
// No category/subcategory breadcrumb-style eyebrow here — the page's real
// Breadcrumb (in the shared layout) already shows that path, so repeating
// it here would just be duplicate noise above the title.
export async function ProductDetail({ product }: { product: Product }) {
  const relatedFilter = product.subcategory
    ? { categorySlug: product.category, subcategorySlug: product.subcategory }
    : { categorySlug: product.category, brandSlug: product.compatibleBrands[0] };
  const [relatedPage, categoryBrandSlugs, directProductCategorySlugs] = await Promise.all([
    getProducts({ ...relatedFilter, pageSize: 5 }),
    getCategoryBrandSlugs(),
    getDirectProductCategorySlugs(),
  ]);
  const relatedProducts = relatedPage.items.filter((item) => item.slug !== product.slug).slice(0, 4);

  return (
    <>
      <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
        <Reveal>
          <ProductGallery images={product.images} alt={product.name} />
        </Reveal>

        <Reveal>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{product.name}</h1>
            {product.shortDescription && <p className="mt-3 text-muted-foreground">{product.shortDescription}</p>}

            <div className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Характеристики
              </h2>
              {product.characteristics && product.characteristics.length > 0 ? (
                <dl className="mt-3 divide-y divide-border">
                  {product.characteristics.map((item) => (
                    <div key={item.attribute} className="flex justify-between gap-4 py-2 text-sm">
                      <dt className="text-muted-foreground">{item.attribute}</dt>
                      <dd className="font-medium text-card-foreground">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">Характеристики уточняются.</p>
              )}
            </div>
          </div>
        </Reveal>
      </div>

      {product.category === "pto" && <PtoNameplateGuide />}

      {relatedProducts.length > 0 && (
        <section className="mt-16 border-t border-border pt-10" aria-labelledby="related-products-title">
          <h2 id="related-products-title" className="text-xl font-semibold text-foreground">
            Похожие товары
          </h2>
          <HoverBorderGrid className="mt-6">
            <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
              {relatedProducts.map((relatedProduct) => (
                <ProductCard
                  key={relatedProduct.slug}
                  product={relatedProduct}
                  href={getProductHref(relatedProduct, categoryBrandSlugs, directProductCategorySlugs)}
                />
              ))}
            </div>
          </HoverBorderGrid>
        </section>
      )}
    </>
  );
}
