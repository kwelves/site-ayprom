export interface CatalogFilterParams {
  q?: string;
  category?: string;
  brand?: string;
  vehicleType?: string;
}

const PARAM_KEYS = ["q", "category", "brand", "vehicleType"] as const;

// Builds a /catalog href from the current active filters plus overrides.
// Page is deliberately never carried over — any filter/search change starts
// back at page 1 so you never land past the end of a smaller result set.
export function catalogHref(
  current: CatalogFilterParams,
  overrides: Partial<CatalogFilterParams> = {},
): string {
  const merged = { ...current, ...overrides };
  const params = new URLSearchParams();
  for (const key of PARAM_KEYS) {
    const value = merged[key];
    if (value) params.set(key, value);
  }
  const search = params.toString();
  return search ? `/catalog?${search}` : "/catalog";
}

// Facet chips are links, not checkboxes: clicking an already-active chip
// clears that facet instead of re-selecting it.
export function toggleFilterHref(
  current: CatalogFilterParams,
  key: "category" | "brand" | "vehicleType",
  value: string,
): string {
  const isActive = current[key] === value;
  return catalogHref(current, { [key]: isActive ? undefined : value });
}

export function hasActiveFacets(current: CatalogFilterParams): boolean {
  return Boolean(current.category || current.brand || current.vehicleType);
}

// For preserving active facets through the search form (hidden inputs) and
// through pagination links, without preserving `q` itself (each carries q
// its own way already) or `page` (see catalogHref).
export function activeFacetParams(current: CatalogFilterParams): Record<string, string> {
  const params: Record<string, string> = {};
  if (current.category) params.category = current.category;
  if (current.brand) params.brand = current.brand;
  if (current.vehicleType) params.vehicleType = current.vehicleType;
  return params;
}
