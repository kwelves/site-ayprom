import {
  parseCatalogSearchRpcRows,
  type CatalogSearchRpc,
} from "@/lib/catalog-search-contract";

export interface PublicSupabaseBindings {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  PUBLICATION_ID?: string;
  PUBLICATION_CAPABILITY?: string;
}

export function createPublicCatalogSearchRpc(
  bindings: PublicSupabaseBindings,
  fetchImplementation: typeof fetch = fetch,
): CatalogSearchRpc {
  return createCatalogSearchRpc(bindings, fetchImplementation, false);
}

/** Worker-only search: never fall back to the active release or editable source. */
export function createPinnedPublicCatalogSearchRpc(
  bindings: PublicSupabaseBindings,
  fetchImplementation: typeof fetch = fetch,
): CatalogSearchRpc {
  return createCatalogSearchRpc(bindings, fetchImplementation, true);
}

function createCatalogSearchRpc(
  bindings: PublicSupabaseBindings,
  fetchImplementation: typeof fetch,
  requirePinned: boolean,
): CatalogSearchRpc {
  return async (request) => {
    const publication = publicationArguments(bindings, requirePinned);
    const publishableKey = bindings.SUPABASE_PUBLISHABLE_KEY.trim();

    if (!isPublicKey(publishableKey)) {
      throw new TypeError("Catalog search configuration unavailable");
    }
    const endpoint = createRpcEndpoint(bindings.SUPABASE_URL);

    // PostgREST ignores Range headers on POST; RPC pagination uses query params.
    endpoint.searchParams.set("offset", String(request.from));
    endpoint.searchParams.set("limit", String(request.pageSize));

    const response = await fetchImplementation(endpoint, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "content-type": "application/json",
        prefer: "count=exact",
      },
      body: JSON.stringify(publication ? { ...request.rpcArgs, ...publication } : request.rpcArgs),
    });

    if (response.status === 416) {
      const count = parseTotalCount(response.headers.get("content-range"));
      if (count >= request.from) {
        throw new TypeError("Catalog search RPC returned inconsistent range metadata");
      }
      return { rows: [], count };
    }

    if (!response.ok) {
      throw new Error(`Catalog search RPC failed with status ${response.status}`);
    }

    const payload: unknown = await response.json();
    const rows = parseCatalogSearchRpcRows(payload);
    const count = parseTotalCount(response.headers.get("content-range"));

    const hasImpossibleReturnedRange =
      rows.length > 0 && count < request.from + rows.length;

    if (rows.length > request.pageSize || hasImpossibleReturnedRange) {
      throw new TypeError("Catalog search RPC returned inconsistent range metadata");
    }

    return {
      rows,
      count,
    };
  };
}

function publicationArguments(bindings: PublicSupabaseBindings, required: boolean): {
  publication_id: string; publication_capability: string;
} | null {
  const id = bindings.PUBLICATION_ID;
  const capability = bindings.PUBLICATION_CAPABILITY;
  if (!required && id === undefined && capability === undefined) return null;
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
    || typeof capability !== "string" || capability.length < 32 || capability.length > 256
    || /[^!-~]/.test(capability)) throw new TypeError("Catalog publication unavailable");
  return { publication_id: id, publication_capability: capability };
}

function isPublicKey(key: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replaceAll("-", "+").replaceAll("_", "/"))) as { role?: unknown };
    return payload.role === "anon";
  } catch { return false; }
}

function createRpcEndpoint(supabaseUrl: string): URL {
  const url = new URL(supabaseUrl);
  url.pathname = "/rest/v1/rpc/search_catalog_products";
  url.search = "";
  url.hash = "";
  return url;
}

function parseTotalCount(contentRange: string | null): number {
  const total = contentRange?.match(/\/(\d+)$/)?.[1];
  if (!total) {
    throw new TypeError("Catalog search RPC did not return an exact count");
  }

  const parsed = Number(total);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError("Catalog search RPC returned an invalid exact count");
  }

  return parsed;
}
