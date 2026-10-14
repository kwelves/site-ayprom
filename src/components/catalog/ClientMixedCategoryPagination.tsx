"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HoverBorderGrid } from "@/components/motion/HoverBorderGrid";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { CategoryCard } from "@/components/home/CategoryCard";
import { ProductCard } from "@/components/catalog/ProductCard";
import { Button } from "@/components/ui/Button";
import { CARD_GRID_GAP_CLASSNAME, getCardGridSizing } from "@/lib/card-system";
import { buildMixedCategoryGridItems } from "@/lib/mixed-category-grid";
import { cn } from "@/lib/utils";
import {
  CATALOG_CLIENT_SEARCH_ERROR_MESSAGE,
  buildCatalogPageUrl,
  buildCatalogSearchApiUrl,
  fetchCatalogSearchPage,
  parseClientCatalogQueryState,
} from "@/lib/catalog-client-search";
import { ClientCatalogPagination } from "@/components/catalog/ClientCatalogSearch";
import type { ProductPage } from "@/lib/catalog-search-contract";
import type { Subcategory } from "@/types/catalog";

export interface ClientMixedCategoryPaginationProps {
  categorySlug: string;
  /** Canonical category path (no query string), e.g.
   * `/catalog/category/hydraulic-pumps`. Every subcategory card, product
   * card, and pagination link is built from this string, not a function —
   * a function prop crossing the Server → "use client" boundary fails at
   * request time (see the same note on ClientCatalogSearch's `basePath`). */
  basePath: string;
  /** Subcategory cards are not paginated — every page shows the same full
   * list, exactly like the current server-rendered branch, which concats
   * ALL subcategories in front of only the current page's direct products
   * (see buildMixedCategoryGridItems). Frozen once by the server; never
   * refetched. */
  subcategories: Subcategory[];
  /** The page-1 direct-product data already baked into the static HTML.
   * Rendered immediately with zero fetch calls, and restored (from memory,
   * still with zero fetch calls) whenever the URL returns to page 1 — e.g.
   * via back/forward. */
  initial: ProductPage;
}

type Status = "idle" | "loading" | "error";

/**
 * Static-build-only client adapter for the mixed-category branch of
 * /catalog/category/[slug] (category.type === "subcategory" with no
 * subcategory segment) — pagination for its direct-product listing only.
 * There is no search box here and none is added: this branch has never had
 * one (see ProjectBrief/spec — search is not part of the mixed listing),
 * and adding one is out of this task's scope.
 *
 * Deliberately a separate component rather than a ClientCatalogSearch
 * option: this branch's grid interleaves subcategory cards with direct
 * products (CategoryCard + ProductCard, via buildMixedCategoryGridItems)
 * and paginates only the product portion, which doesn't fit
 * ClientCatalogSearch's product-only-grid-with-search shape without
 * bending it out of shape for every other page that already uses it. The
 * pagination UI/interaction itself (plain anchors, modifier-key passthrough,
 * pushState) is shared via the exported ClientCatalogPagination.
 */
export function ClientMixedCategoryPagination({
  categorySlug,
  basePath,
  subcategories,
  initial,
}: ClientMixedCategoryPaginationProps) {
  const [page, setPage] = useState<ProductPage>(initial);
  const [status, setStatus] = useState<Status>("idle");

  const initialRef = useRef(initial);
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const applyPage = useCallback(
    (targetPage: number) => {
      controllerRef.current?.abort();
      const requestId = ++requestIdRef.current;

      if (targetPage === 1) {
        // No request: the server already baked page 1 into the page, and
        // it's still sitting in memory.
        setStatus("idle");
        setPage(initialRef.current);
        return;
      }

      const controller = new AbortController();
      controllerRef.current = controller;
      setStatus("loading");

      const url = buildCatalogSearchApiUrl(
        { categorySlug, withoutSubcategory: true },
        { query: undefined, page: targetPage },
      );

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
    [categorySlug],
  );

  useEffect(() => {
    // Deferred exactly like ClientCatalogSearch's mount effect: reading the
    // URL and calling setState must happen outside the effect's synchronous
    // body, and the generation check guards the same race — a pagination
    // click firing synchronously between mount and this microtask.
    const mountGeneration = requestIdRef.current;
    queueMicrotask(() => {
      if (requestIdRef.current !== mountGeneration) return;
      applyPage(parseClientCatalogQueryState(window.location.search).page);
    });

    const handlePopState = () => applyPage(parseClientCatalogQueryState(window.location.search).page);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      controllerRef.current?.abort();
    };
  }, [applyPage]);

  const handlePageClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, targetPage: number) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      window.history.pushState(null, "", buildCatalogPageUrl(basePath, targetPage));
      applyPage(targetPage);
    },
    [applyPage, basePath],
  );

  const handleRetry = () => {
    applyPage(parseClientCatalogQueryState(window.location.search).page);
  };

  // Subcategory cards never depend on the direct-product fetch, so an error
  // there hides only the (now stale) product items, not the whole grid.
  const visibleItems = buildMixedCategoryGridItems(subcategories, status === "error" ? [] : page.items);
  const sizing = getCardGridSizing(visibleItems.length);

  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {status === "loading" ? "Обновляем результаты…" : null}
      </div>

      <HoverBorderGrid className={cn("mt-10", sizing.containerClassName)}>
        <StaggerGroup className={cn("flex flex-wrap justify-center", CARD_GRID_GAP_CLASSNAME)}>
          {visibleItems.map(({ kind, item }) => (
            <StaggerItem key={`${kind}:${item.slug}`} className={sizing.itemClassName}>
              {kind === "subcategory" ? (
                <CategoryCard
                  href={`${basePath}/subcategory/${item.slug}`}
                  image={item.image}
                  name={item.name}
                  sizes="(max-width: 1023px) 30vw, 380px"
                />
              ) : (
                <ProductCard product={item} href={`${basePath}/${item.slug}`} variant="category-grid" />
              )}
            </StaggerItem>
          ))}
        </StaggerGroup>
      </HoverBorderGrid>

      {status === "error" ? (
        <div
          role="alert"
          className="mx-auto mt-8 max-w-xl rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center"
        >
          <p className="text-muted-foreground">{CATALOG_CLIENT_SEARCH_ERROR_MESSAGE}</p>
          <Button type="button" onClick={handleRetry} className="mt-4">
            Повторить
          </Button>
        </div>
      ) : (
        <ClientCatalogPagination
          basePath={basePath}
          page={page.page}
          totalPages={page.totalPages}
          onPageClick={handlePageClick}
        />
      )}
    </>
  );
}
