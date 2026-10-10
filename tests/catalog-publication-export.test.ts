import { describe, expect, it, vi } from "vitest";
import {
  exportCatalogPublication,
  createCatalogPublicationExportSource,
  type CatalogPublicationExportSource,
} from "@/cloudflare/static-build/producer/catalog-publication-export";
import type { CatalogDocumentKind } from "@/lib/catalog-publication-reader";

const releaseId = "20000000-0000-4000-8000-000000000001";
const receipt = { releaseId, revision: 3, sha256: "b".repeat(64), documentCount: 2 };
const capability = "private-pinned-capability-fixture-not-real";
const category = { slug: "a", name: "A" };
const product = { slug: "p", name: "P" };

function twoDocumentSource(): CatalogPublicationExportSource {
  return { list: vi.fn(async (kind: CatalogDocumentKind) => ({
    rows: kind === "category" ? [category] : kind === "product" ? [product] : [],
    total: kind === "category" || kind === "product" ? 1 : 0,
  })) };
}

describe("sealed publication export in the private Node builder", () => {
  it("fetches every kind pinned to one release, counts all records and excludes capability", async () => {
    const source = twoDocumentSource();
    const result = await exportCatalogPublication({ receipt, capability, source });
    expect(result).toMatchObject({ format: 1, releaseId, revision: 3, sha256: receipt.sha256,
      documentCount: 2, documents: { category: [category], product: [product] } });
    expect(Object.keys(result.documents)).toHaveLength(7);
    expect(source.list).toHaveBeenCalledTimes(7);
    expect(source.list).toHaveBeenCalledWith("product", releaseId, capability, 0, 19);
    expect(JSON.stringify(result)).not.toContain(capability);
  });

  it("paginates a kind without silently truncating it", async () => {
    const categories = Array.from({ length: 21 }, (_, n) => ({ slug: `c${n}`, name: `C${n}` }));
    const source: CatalogPublicationExportSource = { list: vi.fn(async (kind, _id, _cap, from) => ({
      rows: kind === "category" ? categories.slice(from, from + 20) : [],
      total: kind === "category" ? categories.length : 0,
    })) };
    const result = await exportCatalogPublication({ receipt: { ...receipt, documentCount: 21 }, capability, source });
    expect(result.documents.category).toHaveLength(21);
    expect(source.list).toHaveBeenCalledWith("category", releaseId, capability, 20, 39);
  });

  it.each(["count_change", "empty_page", "duplicate", "missing", "extra", "malformed"])("fails closed on %s", async (failure) => {
    const source: CatalogPublicationExportSource = { list: vi.fn(async (kind, _id, _cap, from) => {
      if (kind !== "category") return { rows: [], total: 0 };
      if (failure === "count_change") return from === 0
        ? { rows: Array.from({ length: 20 }, (_, n) => ({ slug: `c${n}` })), total: 21 }
        : { rows: [{ slug: "c20" }], total: 22 };
      if (failure === "empty_page") return from === 0
        ? { rows: Array.from({ length: 20 }, (_, n) => ({ slug: `c${n}` })), total: 21 }
        : { rows: [], total: 21 };
      if (failure === "duplicate") return { rows: [{ slug: "a" }, { slug: "a" }], total: 2 };
      if (failure === "missing") return { rows: [category], total: 1 };
      if (failure === "extra") return { rows: [category, product, { slug: "c" }], total: 3 };
      return { rows: [null], total: 1 };
    }) };
    await expect(exportCatalogPublication({ receipt, capability, source })).rejects.toThrow("Catalog export unavailable");
  });

  it("never echoes a backend error or retries a failed page", async () => {
    const list = vi.fn().mockRejectedValue(new Error(capability));
    const failure = await exportCatalogPublication({ receipt, capability, source: { list } }).catch((error: unknown) => error);
    expect(String(failure)).toBe("CatalogPublicationExportError: Catalog export unavailable");
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("sends the capability only in a POST body, using the public key", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([category]), { status: 206,
      headers: { "content-type": "application/json", "content-range": "0-0/1" } }));
    const source = createCatalogPublicationExportSource({ mode: "loopback-fixture",
      supabaseUrl: "http://127.0.0.1:56421", publishableKey: "sb_publishable_fixture" }, fetcher);
    expect(await source.list("category", releaseId, capability, 0, 19)).toEqual({ rows: [category], total: 1 });
    const [url, init] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("http://127.0.0.1:56421/rest/v1/rpc/list_catalog_publication_documents?offset=0&limit=20");
    expect(new Headers(init.headers).get("apikey")).toBe("sb_publishable_fixture");
    expect(new Headers(init.headers).has("range")).toBe(false);
    expect(String(init.body)).toContain(capability);
    expect(url.href).not.toContain(capability);
    expect(init.redirect).toBe("manual");
  });

  it("rejects service-role bindings before any request", () => {
    const fetcher = vi.fn();
    expect(() => createCatalogPublicationExportSource({ mode: "loopback-fixture",
      supabaseUrl: "http://127.0.0.1:56421", publishableKey: "sb_secret_never_export" }, fetcher))
      .toThrow("Catalog export unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { status: 302, range: "0-0/1" },
    { status: 200, range: null },
    { status: 206, range: "0-0/2" },
  ])("rejects an unconfirmed HTTP page %# without leaking capability", async ({ status, range }) => {
    const headers = new Headers();
    if (range) headers.set("content-range", range);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([category]), { status, headers }));
    const source = createCatalogPublicationExportSource({ mode: "loopback-fixture",
      supabaseUrl: "http://127.0.0.1:56421", publishableKey: "sb_publishable_fixture" }, fetcher);
    const error = await source.list("category", releaseId, capability, 0, 19).catch((failure: unknown) => failure);
    expect(String(error)).toBe("CatalogPublicationExportError: Catalog export unavailable");
  });
});
