import { Reveal } from "@/components/motion/Reveal";
import { ProductGallery } from "@/components/catalog/ProductGallery";
import { categories } from "@/data/categories";
import { subcategoriesByCategory } from "@/data/subcategories";
import { brands } from "@/data/brands";
import type { Product } from "@/types/catalog";

// Shared product-detail render, used by both the subcategory-path and the
// brand-path product routes so the page looks identical regardless of which
// navigation route reached it. Every optional block (description,
// characteristics, compatible brands) is omitted entirely when its data is
// missing, so a partially-filled product never renders empty sections.
export function ProductDetail({ product }: { product: Product }) {
  const category = categories.find((item) => item.slug === product.category);
  const subcategory = product.subcategory
    ? subcategoriesByCategory[product.category]?.find((item) => item.slug === product.subcategory)
    : undefined;
  const compatibleBrands = product.compatibleBrands
    .map((brandSlug) => brands.find((brand) => brand.slug === brandSlug))
    .filter((brand): brand is NonNullable<typeof brand> => Boolean(brand));

  const breadcrumb = [category?.name, subcategory?.name].filter(Boolean).join(" / ");

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
      <Reveal>
        <ProductGallery images={product.images} alt={product.name} />
      </Reveal>

      <Reveal>
        <div>
          {breadcrumb && (
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">{breadcrumb}</p>
          )}
          <h1 className="mt-3 text-2xl font-bold text-foreground sm:text-3xl">{product.name}</h1>
          <p className="mt-3 text-slate-600">{product.shortDescription}</p>

          {product.description && <p className="mt-6 text-sm leading-relaxed text-slate-600">{product.description}</p>}

          {product.characteristics && product.characteristics.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Характеристики
              </h2>
              <dl className="mt-3 divide-y divide-border">
                {product.characteristics.map((item) => (
                  <div key={item.attribute} className="flex justify-between gap-4 py-2 text-sm">
                    <dt className="text-slate-600">{item.attribute}</dt>
                    <dd className="font-medium text-card-foreground">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {compatibleBrands.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Совместимые бренды
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {compatibleBrands.map((brand) => (
                  <span
                    key={brand.slug}
                    className="rounded-full border border-border bg-card px-3 py-1 text-sm text-card-foreground"
                  >
                    {brand.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {product.manufacturer && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Производитель</h2>
              <p className="mt-3 text-sm text-card-foreground">{product.manufacturer}</p>
            </div>
          )}
        </div>
      </Reveal>
    </div>
  );
}
