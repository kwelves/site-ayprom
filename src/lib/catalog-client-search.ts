// Reusable client-side search/pagination adapter for the static-build
// (Cloudflare) delivery mode. Pure, framework-agnostic logic lives here so
// it can be unit-tested without React/jsdom and reused by any catalog page
// that needs it later; only the subcategory page wires it up today.
//
// In normal Next/Vercel rendering, search and pagination stay entirely
// server-side (unchanged ProductSearchForm/ProductGridWithSearch). This
// module exists only for the static-build path, where the frozen HTML has
// no server to re-render on a new q/page — the browser has to ask the
// public Worker API directly after hydration.
import type { ProductPage } from "@/lib/catalog-search-contract";
import { pageHref } from "@/components/catalog/ProductGridWithSearch";

export interface ClientCatalogQueryState {
  query?: string;
  page: number;
}

/**
 * Reads only `q`/`page` from a location search string. This page gets its
 * category/subcategory from route segments, not from the query string, and
 * its client never needs any of the other public search keys — category,
 * subcategory, brand, vehicleType, noSubcategory.
 *
 * Deliberately does NOT call the shared `parseCatalogSearchParams`: that
 * function is the public `/api/catalog/search` contract, and it strictly
 * validates `noSubcategory` (rejecting any value but `1`) and the
 * subcategory+noSubcategory conflict — real, load-bearing validation for
 * that endpoint that must stay exactly as strict as it is. Reusing it here
 * would mean an unrelated stray query param (a bookmarked/shared link with
 * `?noSubcategory=bad`, a stale value from another page, plain URL tampering)
 * throws during hydration and breaks this page, which reads none of those
 * keys in the first place. `page`/`query` are normalized with the exact
 * same rule `parseCatalogSearchParams` uses for those two keys, so
 * client-side and server-side page numbers still never disagree — only the
 * unrelated-key strictness is intentionally not inherited.
 */
export function parseClientCatalogQueryState(search: string): ClientCatalogQueryState {
  const params = new URLSearchParams(search);

  const pageValue = Number(params.get("page"));
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;

  const trimmedQuery = params.get("q")?.trim();
  const query = trimmedQuery ? trimmedQuery : undefined;

  return { query, page };
}

/**
 * True when the state matches exactly what the frozen static HTML already
 * contains (page 1, no query) — the one case where no API call is needed.
 */
export function isDefaultCatalogQueryState(state: ClientCatalogQueryState): boolean {
  return !state.query && state.page === 1;
}

// Re-exported under a clearer name for this module's callers: the same URL
// builder the server-rendered pagination already uses, so a client-side
// pushState and a full document navigation land on byte-identical URLs.
export { pageHref as buildCatalogPageUrl };

export interface CatalogClientSearchFilters {
  categorySlug?: string;
  subcategorySlug?: string;
  brandSlug?: string;
  vehicleTypeSlug?: string;
  /** Direct products of a mixed category (no subcategory) — the same
   * `noSubcategory=1` the public API and `search_catalog_products` already
   * accept. Callers never combine this with `subcategorySlug`; the Worker
   * itself rejects that combination with 400. */
  withoutSubcategory?: boolean;
}

/** Builds the public GET /api/catalog/search request the Worker exposes. */
export function buildCatalogSearchApiUrl(
  filters: CatalogClientSearchFilters,
  state: ClientCatalogQueryState,
): string {
  const params = new URLSearchParams();
  if (filters.categorySlug) params.set("category", filters.categorySlug);
  if (filters.subcategorySlug) params.set("subcategory", filters.subcategorySlug);
  if (filters.brandSlug) params.set("brand", filters.brandSlug);
  if (filters.vehicleTypeSlug) params.set("vehicleType", filters.vehicleTypeSlug);
  if (filters.withoutSubcategory) params.set("noSubcategory", "1");
  if (state.query) params.set("q", state.query);
  params.set("page", String(state.page));
  return `/api/catalog/search?${params.toString()}`;
}

/**
 * Fixed, sanitized message shown for every fetch failure — HTTP error,
 * malformed JSON, or a network failure before any response existed. Never
 * derived from the response body or the thrown error: the Worker already
 * sanitizes its own error payloads, but anything between the browser and
 * the Worker (a CDN 522 page, a proxy, a DNS failure) can hand back
 * arbitrary text, and that text must never reach the page.
 */
export const CATALOG_CLIENT_SEARCH_ERROR_MESSAGE =
  "Не удалось загрузить результаты каталога. Попробуйте ещё раз.";

export class CatalogClientSearchError extends Error {
  constructor() {
    super(CATALOG_CLIENT_SEARCH_ERROR_MESSAGE);
    this.name = "CatalogClientSearchError";
  }
}

function isProductPageShape(value: unknown): value is ProductPage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.items) &&
    typeof candidate.total === "number" &&
    typeof candidate.page === "number" &&
    typeof candidate.pageSize === "number" &&
    typeof candidate.totalPages === "number"
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export interface FetchCatalogSearchPageOptions {
  signal?: AbortSignal;
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Fetches one catalog search page from the public Worker API. Every failure
 * mode — network error, non-2xx status, unreadable body, or a body missing
 * the expected `ProductPage` shape — collapses to the same
 * `CatalogClientSearchError` with the same fixed message, except an
 * `AbortError`, which is rethrown as-is so a caller that started a newer
 * request can tell "superseded" apart from "failed" and ignore it silently.
 */
export async function fetchCatalogSearchPage(
  url: string,
  options: FetchCatalogSearchPageOptions = {},
): Promise<ProductPage> {
  const fetchImpl = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      signal: options.signal,
      headers: { accept: "application/json" },
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new CatalogClientSearchError();
  }

  if (!response.ok) {
    throw new CatalogClientSearchError();
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CatalogClientSearchError();
  }

  if (!isProductPageShape(payload)) {
    throw new CatalogClientSearchError();
  }

  return payload;
}
