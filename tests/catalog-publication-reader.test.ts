import { describe, expect, it, vi } from "vitest";
import {
  activeCatalogReaderIfEnabled,
  createActiveCatalogPublicationReader,
  createCatalogPublicationReader,
  type CatalogPublicationSource,
  type CatalogDocumentKind,
} from "@/lib/catalog-publication-reader";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const kind = "category";
const rows = [{ slug: "a", name: "A" }, { slug: "b", name: "B" }];

describe("published catalog reader", () => {
  it("reads the active release through the approved RPC only", async () => {
    const source: CatalogPublicationSource = {
      list: vi.fn().mockResolvedValue(rows),
      get: vi.fn().mockResolvedValue(rows[0]),
    };
    const reader = createCatalogPublicationReader({ mode: "active", source });
    expect(await reader.list(kind)).toEqual(rows);
    expect(await reader.get(kind, "a")).toEqual(rows[0]);
    expect(source.list).toHaveBeenCalledExactlyOnceWith(kind);
    expect(source.get).toHaveBeenCalledExactlyOnceWith(kind, "a");
  });

  it("never substitutes source rows when an active release is unavailable", async () => {
    const source: CatalogPublicationSource = {
      list: vi.fn().mockRejectedValue(new Error("private backend text")),
      get: vi.fn().mockRejectedValue(new Error("private backend text")),
    };
    const reader = createCatalogPublicationReader({ mode: "active", source });
    await expect(reader.list(kind)).rejects.toThrow("Catalog publication unavailable");
    await expect(reader.get(kind, "a")).rejects.toThrow("Catalog publication unavailable");
  });

  it("uses only a sealed local export for the pinned build", async () => {
    const source: CatalogPublicationSource = { list: vi.fn(), get: vi.fn() };
    const reader = createCatalogPublicationReader({ mode: "pinned", source, documents: { category: rows } });
    expect(await reader.list(kind)).toEqual(rows);
    expect(await reader.get(kind, "b")).toEqual(rows[1]);
    expect(source.list).not.toHaveBeenCalled();
    expect(source.get).not.toHaveBeenCalled();
  });

  it("uses PostgreSQL jsonb text keys for composite documents", async () => {
    const source: CatalogPublicationSource = { list: vi.fn(), get: vi.fn() };
    const reader = createCatalogPublicationReader({ mode: "pinned", source,
      documents: { subcategory: [{ category_slug: "mixed", slug: "pump", name: "Pump" }] } });
    expect(await reader.get("subcategory", '["mixed", "pump"]')).toMatchObject({ slug: "pump" });
  });

  it("rejects unknown kinds and malformed keys before the backend", async () => {
    const source: CatalogPublicationSource = { list: vi.fn(), get: vi.fn() };
    const reader = createCatalogPublicationReader({ mode: "active", source });
    await expect(reader.list("admin_credentials" as CatalogDocumentKind)).rejects.toThrow("Catalog publication unavailable");
    await expect(reader.get(kind, "")).rejects.toThrow("Catalog publication unavailable");
    expect(source.list).not.toHaveBeenCalled();
    expect(source.get).not.toHaveBeenCalled();
  });

  it("uses only publishable release RPCs and fails closed on PostgREST truncation", async () => {
    const range = vi.fn().mockResolvedValueOnce({ data: rows, error: null })
      .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, () => rows[0]), error: null });
    const rpc = vi.fn((name: string) => name === "list_catalog_publication_documents"
      ? { range } : Promise.resolve({ data: rows[0], error: null }));
    vi.mocked(createClient).mockResolvedValue({ rpc } as never);
    const reader = await createActiveCatalogPublicationReader();
    expect(await reader.list(kind)).toEqual(rows);
    expect(await reader.get(kind, "a")).toEqual(rows[0]);
    await expect(reader.list(kind)).rejects.toThrow("Catalog publication unavailable");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "list_catalog_publication_documents", "read_catalog_publication_document", "list_catalog_publication_documents",
    ]);
  });

  it("keeps the current source adapter by default and rejects an unsupported mode", async () => {
    const old = process.env.AYPROM_PUBLIC_CATALOG_READ_MODE;
    try {
      delete process.env.AYPROM_PUBLIC_CATALOG_READ_MODE;
      expect(await activeCatalogReaderIfEnabled()).toBeNull();
      process.env.AYPROM_PUBLIC_CATALOG_READ_MODE = "unknown";
      await expect(activeCatalogReaderIfEnabled()).rejects.toThrow("Catalog publication unavailable");
    } finally {
      if (old === undefined) delete process.env.AYPROM_PUBLIC_CATALOG_READ_MODE;
      else process.env.AYPROM_PUBLIC_CATALOG_READ_MODE = old;
    }
  });
});
