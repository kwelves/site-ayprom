/** Public read boundary. This module never accepts a service-role key. */
import { createClient } from "@/lib/supabase/server";
export const CATALOG_DOCUMENT_KINDS = [
  "category", "subcategory", "brand", "category_brand", "vehicle_type",
  "vehicle_hotspot", "product",
] as const;

export type CatalogDocumentKind = (typeof CATALOG_DOCUMENT_KINDS)[number];

export interface CatalogPublicationReader {
  list<T>(kind: CatalogDocumentKind): Promise<T[]>;
  get<T>(kind: CatalogDocumentKind, key: string): Promise<T | null>;
}

export interface CatalogPublicationSource {
  list(kind: CatalogDocumentKind): Promise<unknown>;
  get(kind: CatalogDocumentKind, key: string): Promise<unknown>;
}

type CatalogDocument = Record<string, unknown>;
type PinnedDocuments = Partial<Record<CatalogDocumentKind, readonly CatalogDocument[]>>;
type ReaderOptions =
  | { mode: "active"; source: CatalogPublicationSource }
  | { mode: "pinned"; documents: PinnedDocuments; source?: CatalogPublicationSource };

export class CatalogPublicationReadError extends Error {
  constructor() {
    super("Catalog publication unavailable");
    this.name = "CatalogPublicationReadError";
  }
}

function allowedKind(kind: string): kind is CatalogDocumentKind {
  return (CATALOG_DOCUMENT_KINDS as readonly string[]).includes(kind);
}

/** PostgreSQL jsonb_build_array(a,b)::text uses a space after its separator. */
export function catalogCompositeKey(first: string, second: string): string {
  return `[${JSON.stringify(first)}, ${JSON.stringify(second)}]`;
}

export function catalogDocumentKey(kind: CatalogDocumentKind, row: CatalogDocument): string | null {
  if (kind === "subcategory" || kind === "category_brand") {
    const first = row.category_slug;
    const second = kind === "subcategory" ? row.slug : row.brand_slug;
    return typeof first === "string" && typeof second === "string"
      ? catalogCompositeKey(first, second) : null;
  }
  const value = kind === "vehicle_hotspot" ? row.id : row.slug;
  return typeof value === "string" ? value : null;
}

function checkedRows(value: unknown): CatalogDocument[] {
  if (!Array.isArray(value) || value.length > 20_000 || value.some((row) =>
    !row || typeof row !== "object" || Array.isArray(row))) throw new CatalogPublicationReadError();
  return value as CatalogDocument[];
}

export function createCatalogPublicationReader(options: ReaderOptions): CatalogPublicationReader {
  return {
    async list<T>(kind: CatalogDocumentKind): Promise<T[]> {
      if (!allowedKind(kind)) throw new CatalogPublicationReadError();
      if (options.mode === "pinned") {
        const rows = options.documents[kind];
        if (!rows) throw new CatalogPublicationReadError();
        return checkedRows(rows) as T[];
      }
      try { return checkedRows(await options.source.list(kind)) as T[]; }
      catch { throw new CatalogPublicationReadError(); }
    },
    async get<T>(kind: CatalogDocumentKind, key: string): Promise<T | null> {
      if (!allowedKind(kind) || typeof key !== "string" || key.length === 0 || key.length > 256) {
        throw new CatalogPublicationReadError();
      }
      if (options.mode === "pinned") {
        const rows = options.documents[kind];
        if (!rows) throw new CatalogPublicationReadError();
        return (checkedRows(rows).find((row) => catalogDocumentKey(kind, row) === key) as T | undefined) ?? null;
      }
      try {
        const row = await options.source.get(kind, key);
        if (row === null) return null;
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new CatalogPublicationReadError();
        return row as T;
      } catch { throw new CatalogPublicationReadError(); }
    },
  };
}

/**
 * Legacy Next adapter: a single public RPC per read, with no direct-table
 * fallback. A larger list fails closed until a release-stable paging contract
 * is available; PostgREST's default 1,000-row limit must never truncate it.
 */
export async function createActiveCatalogPublicationReader(): Promise<CatalogPublicationReader> {
  const supabase = await createClient();
  return createCatalogPublicationReader({
    mode: "active",
    source: {
      async list(kind) {
        const { data, error } = await supabase.rpc("list_catalog_publication_documents", { kind }).range(0, 999);
        if (error || !Array.isArray(data) || data.length >= 1_000) throw new CatalogPublicationReadError();
        return data;
      },
      async get(kind, key) {
        const { data, error } = await supabase.rpc("read_catalog_publication_document", { kind, key });
        if (error) throw new CatalogPublicationReadError();
        return data;
      },
    },
  });
}

/** Off by default until the release-read compatibility gate is complete. */
export function catalogPublicationReadMode(): "source" | "active" | "pinned" {
  const mode = process.env.AYPROM_PUBLIC_CATALOG_READ_MODE;
  if (mode === undefined || mode === "source") return "source";
  if (mode === "active") return "active";
  if (mode === "pinned" && process.env.AYPROM_STATIC_BUILD === "1") return "pinned";
  throw new CatalogPublicationReadError();
}

export async function activeCatalogReaderIfEnabled(): Promise<CatalogPublicationReader | null> {
  const mode = catalogPublicationReadMode();
  if (mode === "source") return null;
  if (mode === "active") return createActiveCatalogPublicationReader();
  const filePath = process.env.AYPROM_PUBLIC_CATALOG_EXPORT_PATH;
  const sha256 = process.env.AYPROM_PUBLIC_CATALOG_EXPORT_SHA256;
  const releaseId = process.env.AYPROM_PUBLIC_CATALOG_RELEASE_ID;
  if (!filePath || !sha256 || !releaseId) throw new CatalogPublicationReadError();
  try {
    const { loadCatalogPublicationFile } = await import("@/lib/catalog-publication-file");
    const publication = await loadCatalogPublicationFile({ repoRoot: process.cwd(),
      path: filePath, sha256, releaseId });
    return createCatalogPublicationReader({ mode: "pinned", documents: publication.documents });
  } catch { throw new CatalogPublicationReadError(); }
}
