"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { HoverBorderGrid } from "@/components/motion/HoverBorderGrid";
import { ProductCard } from "@/components/catalog/ProductCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { CARD_GRID_GAP_CLASSNAME } from "@/lib/card-system";
import { cn } from "@/lib/utils";
import {
  CATALOG_CLIENT_SEARCH_ERROR_MESSAGE,
  buildCatalogPageUrl,
  buildCatalogSearchApiUrl,
  fetchCatalogSearchPage,
  isDefaultCatalogQueryState,
  parseClientCatalogQueryState,
  type CatalogClientSearchFilters,
  type ClientCatalogQueryState,
} from "@/lib/catalog-client-search";
import { getProductHref } from "@/lib/product-href";
import type { ProductPage } from "@/lib/catalog-search-contract";
import type { ProductListItem } from "@/types/catalog";

/**
 * Data needed to compute each product's own canonical URL for a
 * cross-category listing (`/catalog`, `/catalog/vehicle-type/[slug]`) —
 * every other page in this family links every product from one shared
 * `basePath`/`productBasePath`, but these two mix products from any
 * category/subcategory/brand, so each one needs `getProductHref`, exactly
 * like the server does today for the same pages.
 *
 * A single object, not two separate optional props: either both fields are
 * present or neither is, so a caller can never accidentally wire up half of
 * it (e.g. `categoryBrandSlugs` without `directProductCategorySlugs`) and
 * get a silently wrong link instead of a type error.
 *
 * `directProductCategorySlugs` is an array, not a `Set` — a `Set` isn't
 * guaranteed to survive RSC prop serialization the way a plain
 * array/object does, so the Server Component converts it once
 * (`[...directProductCategorySlugs]`) before handing it across the
 * boundary; `getProductHref` itself still wants a `Set`, rebuilt here.
 *
 * Deliberately calls the shared `getProductHref` (`@/lib/product-href.ts`)
 * instead of re-implementing its brand-selection rule here: that function is
 * not touched by this change, so a later fix to its tie-breaking order
 * (picking a brand independent of `compatibleBrands` order) applies to this
 * client adapter automatically once merged, with no second copy to update.
 */
export interface CatalogProductRouting {
  categoryBrandSlugs: Record<string, string[]>;
  directProductCategorySlugs: string[];
}

export interface ClientCatalogSearchProps extends CatalogClientSearchFilters {
  /** Canonical path for this page (no query string), e.g.
   * `/catalog/category/pumps/subcategory/gear-pumps`. Used both for
   * `history.pushState` and as the plain-document fallback `href`/`action`
   * on every link and form, so the adapter degrades to a real navigation
   * whenever JS doesn't run, is disabled, or a click carries a modifier
   * key / isn't a plain left click. Also the base every product card links
   * from — `${basePath}/${product.slug}` — unless `productBasePath` is
   * given (see below), matching most of this page family's URL shapes
   * (subcategory, brand-scoped category) without needing a function prop —
   * a function passed from a Server Component to a "use client" component
   * fails at request time with "Functions cannot be passed directly to
   * Client Components" (confirmed with a real `next build` + `next start`
   * smoke against a running local Supabase; no jsdom/unit test crosses that
   * real server/client boundary, so this is the one thing they cannot catch
   * on their own). */
  basePath: string;
  /** Overrides the base a product card links from, for the one page in this
   * family whose list URL and canonical product URL genuinely diverge:
   * `/catalog/brand/[slug]/category/[categorySlug]/subcategory/[subSlug]`
   * paginates itself at that brand-scoped path (`basePath`) but every
   * product still links to its one canonical URL,
   * `/catalog/category/[categorySlug]/subcategory/[subSlug]/[slug]`
   * (`productBasePath`) — the same URL the plain category/subcategory page
   * would use, so a product page never has two different incoming links.
   * String, not a function, for the same Server→Client boundary reason as
   * `basePath` itself. Defaults to `basePath` when omitted. */
  productBasePath?: string;
  /** For cross-category listings (`/catalog`, `/catalog/vehicle-type/[slug]`)
   * only — computes each product's own link via `getProductHref` instead of
   * `basePath`/`productBasePath`. Omit entirely for every other page in this
   * family, where one shared base path is still correct and simpler. See
   * `CatalogProductRouting` for why this is one object, not two props. */
  productRouting?: CatalogProductRouting;
  /** The page-1/no-query data already baked into the static HTML by the
   * server. Rendered immediately with zero fetch calls, and restored
   * (from memory, still with zero fetch calls) whenever the URL returns to
   * that same default state — e.g. via back/forward or clearing search. */
  initial: ProductPage;
  scopeLabel: string;
  emptyLabel: string;
  searchPlaceholder: string;
}

type Status = "idle" | "loading" | "error";

const gridClassName = cn("grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4", CARD_GRID_GAP_CLASSNAME);

function isPlainLeftClick(event: React.MouseEvent): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/**
 * Reusable client-side search/pagination adapter for the static-build
 * delivery mode. Not used in normal Next/Vercel rendering — there,
 * ProductSearchForm + ProductGridWithSearch keep doing exactly what they do
 * today, server-side, via real navigation.
 *
 * Every link and the search form here render a real `href`/`action` first;
 * the onClick/onSubmit handlers only intercept a plain, unmodified,
 * default-not-already-prevented click, so opening in a new tab, disabled
 * JS, or a failed hydration all still work as ordinary document
 * navigation — the static HTML at every one of these URLs is the same
 * frozen page-1 document, so that fallback is always "correct", just not
 * query-aware without JavaScript, matching the spec's stated tradeoff.
 *
 * Deliberately NOT covered here: each product card below still navigates via
 * ProductCard's own internal next/link `Link` (and its Framer tap-to-`router.
 * push` gesture), unchanged, exactly as it does on every other catalog page.
 * Whether that resolves correctly once this page is served as frozen static
 * HTML with no Worker to answer an RSC/prefetch request is the general
 * "static-build public navigation" concern the spec assigns to its own
 * site-wide browser gate (see "Next navigation and RSC" in
 * docs/superpowers/specs/2026-09-21-ayprom-crawl-and-freeze-design.md), not
 * to this page's search/pagination adapter — fixing it here would be
 * exactly the scope creep this task was told to avoid ("не расширяй задачу
 * на весь каталог"). Left as an explicit, unverified browser gate for that
 * separate piece of work, not silently assumed to work.
 */
export function ClientCatalogSearch({
  categorySlug,
  subcategorySlug,
  brandSlug,
  vehicleTypeSlug,
  basePath,
  productBasePath,
  productRouting,
  initial,
  scopeLabel,
  emptyLabel,
  searchPlaceholder,
}: ClientCatalogSearchProps) {
  const productLinkBase = productBasePath ?? basePath;
  const resolveProductHref = productRouting
    ? (item: ProductListItem) =>
        getProductHref(
          item,
          productRouting.categoryBrandSlugs,
          new Set(productRouting.directProductCategorySlugs),
        )
    : (item: ProductListItem) => `${productLinkBase}/${item.slug}`;
  const [page, setPage] = useState<ProductPage>(initial);
  const [status, setStatus] = useState<Status>("idle");
  const [queryInput, setQueryInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState<string | undefined>(undefined);

  const initialRef = useRef(initial);
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const filters: CatalogClientSearchFilters = { categorySlug, subcategorySlug, brandSlug, vehicleTypeSlug };

  const applyState = useCallback(
    (state: ClientCatalogQueryState) => {
      setQueryInput(state.query ?? "");
      setAppliedQuery(state.query);

      controllerRef.current?.abort();
      // Incremented for every transition, including the no-fetch default
      // case below — the mount effect's deferred initial sync (see below)
      // uses this same counter to detect that a real navigation has already
      // happened and skip itself instead of clobbering it.
      const requestId = ++requestIdRef.current;

      if (isDefaultCatalogQueryState(state)) {
        // No request: the server already baked this exact state into the
        // page, and it's still sitting in memory.
        setStatus("idle");
        setPage(initialRef.current);
        return;
      }

      const controller = new AbortController();
      controllerRef.current = controller;
      setStatus("loading");

      const url = buildCatalogSearchApiUrl(filters, state);

      fetchCatalogSearchPage(url, { signal: controller.signal }).then(
        (result) => {
          if (requestIdRef.current !== requestId) return; // superseded by a newer request
          setPage(result);
          setStatus("idle");
        },
        (error: unknown) => {
          if (requestIdRef.current !== requestId) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          setStatus("error");
        },
      );
    },
    // categorySlug/subcategorySlug/brandSlug/vehicleTypeSlug are this page's
    // route params — stable for the component's lifetime, listed explicitly
    // instead of via the `filters` object so the identity of applyState only
    // changes if one of them actually does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categorySlug, subcategorySlug, brandSlug, vehicleTypeSlug],
  );

  useEffect(() => {
    // Reading the URL and calling setState must happen outside the effect's
    // synchronous body (React flags a direct setState call there as a
    // cascading-render risk) — deferred exactly like useInViewOnce's
    // SSR/no-IntersectionObserver fallback elsewhere in this codebase.
    //
    // The generation check guards a real race: a form submit or pagination
    // click can run synchronously between mount and this microtask (e.g. a
    // test firing events right after render, or a user who's fast enough).
    // That already called applyState and bumped requestIdRef, so the
    // deferred initial sync — reading a URL that navigation may have since
    // changed again — must not run at all, not even redundantly.
    const mountGeneration = requestIdRef.current;
    queueMicrotask(() => {
      if (requestIdRef.current !== mountGeneration) return;
      applyState(parseClientCatalogQueryState(window.location.search));
    });

    const handlePopState = () => applyState(parseClientCatalogQueryState(window.location.search));
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      controllerRef.current?.abort();
    };
  }, [applyState]);

  const navigate = useCallback(
    (state: ClientCatalogQueryState) => {
      const url = buildCatalogPageUrl(basePath, state.page, state.query);
      window.history.pushState(null, "", url);
      applyState(state);
    },
    [applyState, basePath],
  );

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = queryInput.trim();
    navigate({ query: trimmed || undefined, page: 1 });
  };

  const handleClear = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainLeftClick(event)) return;
    event.preventDefault();
    navigate({ query: undefined, page: 1 });
  };

  const handlePageClick = (event: React.MouseEvent<HTMLAnchorElement>, targetPage: number) => {
    if (!isPlainLeftClick(event)) return;
    event.preventDefault();
    navigate({ query: appliedQuery, page: targetPage });
  };

  const handleRetry = () => {
    applyState(parseClientCatalogQueryState(window.location.search));
  };

  return (
    <>
      <div className="mt-6">
        <form
          action={basePath}
          method="GET"
          onSubmit={handleSubmit}
          className="mx-auto flex w-full max-w-lg items-center gap-2 rounded-lg border border-input bg-card p-1.5 shadow-sm transition-[border-color,box-shadow] duration-fast ease-ui focus-within:border-ring focus-within:ring-1 focus-within:ring-ring"
        >
          <Search aria-hidden="true" className="ml-2 h-5 w-5 shrink-0 text-faint-foreground" />
          <input
            type="text"
            name="q"
            aria-label="Поиск по каталогу"
            autoComplete="off"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder={`${searchPlaceholder}…`}
            className="h-10 w-full border-0 bg-transparent text-base text-foreground outline-none placeholder:text-faint-foreground"
          />
          <Button type="submit" className="shrink-0">
            Найти
          </Button>
        </form>
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {status === "loading" ? "Обновляем результаты…" : null}
      </div>

      {status === "error" ? (
        <div role="alert" className="mx-auto mt-8 max-w-xl rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
          <p className="text-muted-foreground">{CATALOG_CLIENT_SEARCH_ERROR_MESSAGE}</p>
          <Button type="button" onClick={handleRetry} className="mt-4">
            Повторить
          </Button>
        </div>
      ) : page.items.length === 0 ? (
        <EmptyState
          title={appliedQuery ? "Ничего не найдено" : "Товаров пока нет"}
          description={
            appliedQuery ? `По запросу «${appliedQuery}» ${scopeLabel} ничего не найдено.` : emptyLabel
          }
          action={
            appliedQuery ? (
              <a
                href={basePath}
                onClick={handleClear}
                className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors duration-fast ease-ui hover:bg-primary-hover"
              >
                Очистить поиск
              </a>
            ) : (
              <a
                href="/catalog"
                className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors duration-fast ease-ui hover:bg-primary-hover"
              >
                Открыть весь каталог
              </a>
            )
          }
        />
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-muted-foreground">
              Найдено товаров: <span className="font-semibold text-foreground">{page.total}</span>
            </p>
            {appliedQuery && (
              <a
                href={basePath}
                onClick={handleClear}
                className="rounded-full border border-border-interactive bg-accent px-3 py-1.5 font-medium text-primary transition-colors duration-fast ease-ui hover:bg-accent-strong"
              >
                Поиск: «{appliedQuery}» ×
              </a>
            )}
          </div>

          <HoverBorderGrid className="mt-6">
            <div className={gridClassName} aria-busy={status === "loading"}>
              {page.items.map((item) => (
                <ProductCard key={item.slug} product={item} href={resolveProductHref(item)} />
              ))}
            </div>
          </HoverBorderGrid>

          <ClientCatalogPagination
            basePath={basePath}
            page={page.page}
            totalPages={page.totalPages}
            query={appliedQuery}
            onPageClick={handlePageClick}
          />
        </>
      )}
    </>
  );
}

/**
 * Exported for reuse by ClientMixedCategoryPagination — same plain-anchor,
 * modifier-key-respecting pagination UI/behavior, so the mixed-category
 * direct-product listing paginates identically to every other static-build
 * page instead of a second hand-written copy of this click-interception
 * logic drifting from it over time.
 */
export function ClientCatalogPagination({
  basePath,
  page,
  totalPages,
  query,
  onPageClick,
}: {
  basePath: string;
  page: number;
  totalPages: number;
  query?: string;
  onPageClick: (event: React.MouseEvent<HTMLAnchorElement>, targetPage: number) => void;
}) {
  if (totalPages <= 1) return null;

  const visiblePages = Array.from({ length: totalPages }, (_, index) => index + 1).filter(
    (candidate) => candidate === 1 || candidate === totalPages || Math.abs(candidate - page) <= 2,
  );

  return (
    <nav className="mt-10 flex flex-wrap items-center justify-center gap-2" aria-label="Страницы каталога">
      <a
        href={buildCatalogPageUrl(basePath, Math.max(1, page - 1), query)}
        aria-disabled={page <= 1}
        onClick={(event) => onPageClick(event, Math.max(1, page - 1))}
        className={cn(
          "rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-fast ease-ui",
          page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-accent",
        )}
      >
        Назад
      </a>
      {visiblePages.map((candidate, index) => {
        const previous = visiblePages[index - 1];
        return (
          <span key={candidate} className="contents">
            {previous && candidate - previous > 1 && <span className="px-1 text-muted-foreground">…</span>}
            <a
              href={buildCatalogPageUrl(basePath, candidate, query)}
              aria-current={candidate === page ? "page" : undefined}
              onClick={(event) => onPageClick(event, candidate)}
              className={cn(
                "min-w-10 rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors duration-fast ease-ui",
                candidate === page
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-accent",
              )}
            >
              {candidate}
            </a>
          </span>
        );
      })}
      <a
        href={buildCatalogPageUrl(basePath, Math.min(totalPages, page + 1), query)}
        aria-disabled={page >= totalPages}
        onClick={(event) => onPageClick(event, Math.min(totalPages, page + 1))}
        className={cn(
          "rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-fast ease-ui",
          page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-accent",
        )}
      >
        Вперёд
      </a>
    </nav>
  );
}
