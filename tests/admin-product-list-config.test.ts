import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADMIN_PRODUCT_LIST_CONFIG,
  buildAdminProductMutationRedirect,
  buildAdminProductMutationRedirectFailSoft,
  getRelaxedAdminProductListConfig,
  parseAdminProductListConfigCookie,
  resolveAdminProductListConfig,
  serializeAdminProductListConfigCookie,
} from "@/lib/admin/product-list-config";
import { parseAdminProductListConfigDocumentCookie } from "@/lib/admin/product-list-config-cookie";

describe("admin product list config", () => {
  const saved = {
    category: "forklifts",
    status: "published" as const,
    availability: "in_stock" as const,
    sort: "updated" as const,
  };

  it("round-trips the versioned cookie and rejects malformed or unsupported values", () => {
    const serialized = serializeAdminProductListConfigCookie(saved);
    expect(JSON.parse(decodeURIComponent(serialized))).toEqual({ v: 1, ...saved });
    expect(parseAdminProductListConfigCookie(serialized)).toEqual(saved);
    expect(parseAdminProductListConfigCookie("not-json")).toBeNull();
    expect(parseAdminProductListConfigCookie(encodeURIComponent(JSON.stringify({ v: 2, ...saved })))).toBeNull();
    expect(
      parseAdminProductListConfigCookie(
        encodeURIComponent(JSON.stringify({ v: 1, ...saved, sort: "unsupported" })),
      ),
    ).toBeNull();
  });

  it("finds and validates the saved config in a document.cookie string", () => {
    const serialized = serializeAdminProductListConfigCookie(saved);

    expect(
      parseAdminProductListConfigDocumentCookie(`session=abc; admin_products_list_config=${serialized}; theme=dark`),
    ).toEqual(saved);
    expect(parseAdminProductListConfigDocumentCookie("session=abc; theme=dark")).toBeNull();
    expect(parseAdminProductListConfigDocumentCookie("admin_products_list_config=invalid")).toBeNull();
  });

  it("uses saved values on a clean URL and exact URL defaults in explicit/target modes", () => {
    expect(resolveAdminProductListConfig({}, saved)).toEqual({ config: saved, view: null });
    expect(resolveAdminProductListConfig({ view: "explicit", sort: "name" }, saved)).toEqual({
      config: { ...DEFAULT_ADMIN_PRODUCT_LIST_CONFIG, sort: "name" },
      view: "explicit",
    });
    expect(resolveAdminProductListConfig({ view: "target", category: "parts" }, saved)).toEqual({
      config: { ...DEFAULT_ADMIN_PRODUCT_LIST_CONFIG, category: "parts" },
      view: "target",
    });
  });

  it("relaxes only filters that hide the saved product and keeps sorting", () => {
    expect(
      getRelaxedAdminProductListConfig(saved, {
        categorySlug: "parts",
        published: false,
        availability: "out_of_stock",
      }),
    ).toEqual({
      config: { ...DEFAULT_ADMIN_PRODUCT_LIST_CONFIG, sort: "updated" },
      relaxed: ["category", "status", "availability"],
    });

    expect(
      getRelaxedAdminProductListConfig(saved, {
        categorySlug: "forklifts",
        published: true,
        availability: "in_stock",
      }),
    ).toEqual({ config: saved, relaxed: [] });
  });

  it("builds a target redirect that retains the temporary view and warning", () => {
    const url = buildAdminProductMutationRedirect({
      config: { ...DEFAULT_ADMIN_PRODUCT_LIST_CONFIG, sort: "name" },
      page: 2,
      flashAction: "created",
      slug: "new product",
      photoErrorCount: 2,
      relaxed: ["category"],
    });
    const parsed = new URL(url, "https://example.test");
    expect(parsed.pathname).toBe("/admin/products");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      view: "target",
      sort: "name",
      relaxed: "category",
      page: "2",
      created: "new product",
      photoError: "2",
    });
  });

  it("keeps a completed mutation successful when target-page lookup fails", async () => {
    const lookupError = new Error("range lookup unavailable");
    const result = await buildAdminProductMutationRedirectFailSoft(
      {
        config: { ...DEFAULT_ADMIN_PRODUCT_LIST_CONFIG, sort: "name" },
        flashAction: "updated",
        slug: "saved-product",
      },
      async () => {
        throw lookupError;
      },
    );

    expect(result.lookupError).toBe(lookupError);
    expect(result.href).toBe("/admin/products?updated=saved-product");
  });
});
