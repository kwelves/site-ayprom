import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { ProductCard } from "@/components/catalog/ProductCard";
import { searchProducts } from "@/lib/search-products";
import { getProductHref } from "@/lib/product-href";
import { getProducts } from "@/lib/queries/products";
import { getCategoryBrandSlugs } from "@/lib/queries/category-brands";
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

// Search is scoped to the current page first; only falls back to a global
// search (across every category/brand) when the scoped search comes up
// empty — narrowing what browsing already narrowed, not replacing it.
export async function ProductGridWithSearch({
  products,
  query,
  scopeLabel,
  href,
  emptyLabel,
}: ProductGridWithSearchProps) {
  if (!query) {
    return products.length > 0 ? (
      <ProductGrid products={products} hrefFor={href} />
    ) : (
      <p className="mt-6 text-center text-slate-600">{emptyLabel}</p>
    );
  }

  const scopedResults = await searchProducts(products, query);

  if (scopedResults.length > 0) {
    return <ProductGrid products={scopedResults} hrefFor={href} />;
  }

  const [allProducts, categoryBrandSlugs] = await Promise.all([getProducts(), getCategoryBrandSlugs()]);
  const globalResults = await searchProducts(allProducts, query);

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
          <ProductGrid products={globalResults} hrefFor={(product) => getProductHref(product, categoryBrandSlugs)} />
        </>
      )}
    </div>
  );
}
