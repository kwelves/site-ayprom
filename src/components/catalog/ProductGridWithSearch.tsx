import Link from "next/link";
import { Reveal } from "@/components/motion/Reveal";
import { ProductCard } from "@/components/catalog/ProductCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import type { ProductListItem } from "@/types/catalog";

interface ProductGridWithSearchProps {
  products: ProductListItem[];
  total: number;
  page: number;
  totalPages: number;
  query?: string;
  scopeLabel: string;
  action: string;
  href: (product: ProductListItem) => string;
  emptyLabel: string;
}

const gridClassName = "mt-6 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4";

function pageHref(action: string, page: number, query?: string): string {
  const params = new URLSearchParams();
  if (query?.trim()) params.set("q", query.trim());
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `${action}?${search}` : action;
}

export function CatalogPagination({
  action,
  page,
  totalPages,
  query,
}: {
  action: string;
  page: number;
  totalPages: number;
  query?: string;
}) {
  if (totalPages <= 1) return null;

  const visiblePages = Array.from({ length: totalPages }, (_, index) => index + 1).filter(
    (candidate) => candidate === 1 || candidate === totalPages || Math.abs(candidate - page) <= 2,
  );

  return (
    <nav className="mt-10 flex flex-wrap items-center justify-center gap-2" aria-label="Страницы каталога">
      <Link
        href={pageHref(action, Math.max(1, page - 1), query)}
        aria-disabled={page <= 1}
        className={cn(
          "rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-fast ease-ui",
          page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-accent",
        )}
      >
        Назад
      </Link>
      {visiblePages.map((candidate, index) => {
        const previous = visiblePages[index - 1];
        return (
          <span key={candidate} className="contents">
            {previous && candidate - previous > 1 && <span className="px-1 text-muted-foreground">…</span>}
            <Link
              href={pageHref(action, candidate, query)}
              aria-current={candidate === page ? "page" : undefined}
              className={cn(
                "min-w-10 rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors duration-fast ease-ui",
                candidate === page
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-accent",
              )}
            >
              {candidate}
            </Link>
          </span>
        );
      })}
      <Link
        href={pageHref(action, Math.min(totalPages, page + 1), query)}
        aria-disabled={page >= totalPages}
        className={cn(
          "rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-fast ease-ui",
          page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-accent",
        )}
      >
        Вперёд
      </Link>
    </nav>
  );
}

export function ProductGridWithSearch({
  products,
  total,
  page,
  totalPages,
  query,
  scopeLabel,
  action,
  href,
  emptyLabel,
}: ProductGridWithSearchProps) {
  if (products.length === 0) {
    return (
      <EmptyState
        title={query ? "Ничего не найдено" : "Товаров пока нет"}
        description={query ? `По запросу «${query}» ${scopeLabel} ничего не найдено.` : emptyLabel}
        actionHref={query ? action : "/catalog"}
        actionLabel={query ? "Очистить поиск" : "Открыть весь каталог"}
      />
    );
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground">
          Найдено товаров: <span className="font-semibold text-foreground">{total}</span>
        </p>
        {query && (
          <Link
            href={action}
            className="rounded-full border border-border-interactive bg-accent px-3 py-1.5 font-medium text-primary transition-colors duration-fast ease-ui hover:bg-accent-strong"
          >
            Поиск: «{query}» ×
          </Link>
        )}
      </div>

      <Reveal className={gridClassName}>
        {products.map((product) => (
          <ProductCard key={product.slug} product={product} href={href(product)} />
        ))}
      </Reveal>

      <CatalogPagination action={action} page={page} totalPages={totalPages} query={query} />
    </>
  );
}
