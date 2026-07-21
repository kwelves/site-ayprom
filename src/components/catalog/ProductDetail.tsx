import Link from "next/link";
import { Reveal } from "@/components/motion/Reveal";
import { ProductGallery } from "@/components/catalog/ProductGallery";
import { getBrands } from "@/lib/queries/brands";
import { getVehicleTypes } from "@/lib/queries/vehicle-types";
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
  const [brands, vehicleTypes] = await Promise.all([getBrands(), getVehicleTypes()]);
  const compatibleBrands = product.compatibleBrands
    .map((brandSlug) => brands.find((brand) => brand.slug === brandSlug))
    .filter((brand): brand is NonNullable<typeof brand> => Boolean(brand));
  const productVehicleTypes = product.vehicleTypes
    .map((vehicleTypeSlug) => vehicleTypes.find((vehicleType) => vehicleType.slug === vehicleTypeSlug))
    .filter((vehicleType): vehicleType is NonNullable<typeof vehicleType> => Boolean(vehicleType));

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
      <Reveal>
        <ProductGallery images={product.images} alt={product.name} />
      </Reveal>

      <Reveal>
        <div>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{product.name}</h1>
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

          {compatibleBrands.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Совместимые бренды
              </h2>
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
            </div>
          )}
        </div>
      </Reveal>
    </div>
  );
}
