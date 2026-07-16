import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { ProductCard } from "@/components/catalog/ProductCard";
import { searchProducts } from "@/lib/search-products";
import { getProductHref } from "@/lib/product-href";
import { products as allProducts } from "@/data/products";
import type { Product } from "@/types/catalog";

interface ProductGridWithSearchProps {
  /** The current page's own product scope (e.g. one subcategory's products). */
  products: Product[];
  /** The `q` search param, if present. */
  query?: string;
  /** Used in "nothing found" copy, e.g. `в подкатегории «Шестерённые насосы»`. */
  scopeLabel: string;
  /** Link for a result within the current scope. */
  href: (product: Product) => string;
  /** Shown when there's no query and the scope itself has no products yet. */
  emptyLabel: string;
  /** Only set on brand pages — splits results within the current scope into
   * "Для {name}" (mainBrand match) and "Совместимо с {name}" (only in
   * compatibleBrands). Doesn't apply to the cross-catalog fallback grid,
   * since that one isn't scoped to this brand in the first place. */
  brandTier?: { slug: string; name: string };
}

const gridClassName = "mt-6 grid grid-cols-2 gap-5 lg:grid-cols-4";

function ProductGrid({ products, hrefFor }: { products: Product[]; hrefFor: (product: Product) => string }) {
  return (
    <StaggerGroup className={gridClassName}>
      {products.map((product) => (
        <StaggerItem key={product.slug}>
          <ProductCard product={product} href={hrefFor(product)} />
        </StaggerItem>
      ))}
    </StaggerGroup>
  );
}

function splitByBrandTier(list: Product[], brandSlug: string) {
  const primary = list.filter((product) => product.mainBrand === brandSlug);
  const secondary = list.filter(
    (product) => product.compatibleBrands.includes(brandSlug) && product.mainBrand !== brandSlug
  );
  return { primary, secondary };
}

function TieredResults({
  products,
  hrefFor,
  brandTier,
}: {
  products: Product[];
  hrefFor: (product: Product) => string;
  brandTier?: { slug: string; name: string };
}) {
  if (!brandTier) {
    return <ProductGrid products={products} hrefFor={hrefFor} />;
  }

  const { primary, secondary } = splitByBrandTier(products, brandTier.slug);

  // Only label the split when there's actually something on both sides to
  // contrast — a lone tier renders as a plain grid, same as no brandTier.
  if (primary.length === 0 || secondary.length === 0) {
    return <ProductGrid products={products} hrefFor={hrefFor} />;
  }

  return (
    <div className="mt-10 space-y-8">
      <div>
        <TierLabel text={`Для ${brandTier.name}`} />
        <ProductGrid products={primary} hrefFor={hrefFor} />
      </div>
      <div>
        <TierLabel text={`Совместимо с ${brandTier.name}`} />
        <ProductGrid products={secondary} hrefFor={hrefFor} />
      </div>
    </div>
  );
}

function TierLabel({ text }: { text: string }) {
  return <p className="text-center text-sm font-semibold uppercase tracking-wide text-muted-foreground">{text}</p>;
}

// Search is scoped to the current page first; only falls back to a global
// search (across every category/brand) when the scoped search comes up
// empty — narrowing what browsing already narrowed, not replacing it.
export function ProductGridWithSearch({
  products,
  query,
  scopeLabel,
  href,
  emptyLabel,
  brandTier,
}: ProductGridWithSearchProps) {
  if (!query) {
    return products.length > 0 ? (
      <TieredResults products={products} hrefFor={href} brandTier={brandTier} />
    ) : (
      <p className="mt-6 text-center text-slate-600">{emptyLabel}</p>
    );
  }

  const scopedResults = searchProducts(products, query);

  if (scopedResults.length > 0) {
    return <TieredResults products={scopedResults} hrefFor={href} brandTier={brandTier} />;
  }

  const globalResults = searchProducts(allProducts, query);

  return (
    <div>
      <p className="mt-6 text-center text-slate-600">
        По запросу «{query}» {scopeLabel} ничего не найдено.
      </p>

      {globalResults.length > 0 && (
        <>
          <div className="mx-auto mt-8 max-w-2xl border-t border-border" />
          <p className="mt-8 text-center text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Возможно, вы имеете в виду
          </p>
          <ProductGrid products={globalResults} hrefFor={getProductHref} />
        </>
      )}
    </div>
  );
}
