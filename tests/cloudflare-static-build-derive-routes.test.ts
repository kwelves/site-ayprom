import { describe, expect, it } from "vitest";
import { createRouteManifest, derivePublicRoutes, serializeRouteManifest } from "@/cloudflare/static-build";
import type { CatalogSnapshot } from "@/cloudflare/static-build/snapshot";

const siteUrl = "https://www.ayprom-gidravlika.kg";

const snapshot = (): CatalogSnapshot => ({
  schemaVersion: 1,
  snapshotId: "fixture",
  categories: [
    { slug: "fittings", name: "Фитинги", type: null },
    { slug: "pumps", name: "Насосы", type: "subcategory" },
    { slug: "tanks", name: "Баки", type: "subcategory" },
    { slug: "pto", name: "КОМ", type: "brand" },
  ],
  subcategories: [
    { slug: "parts", name: "Детали насосов", categorySlug: "pumps" },
    { slug: "parts", name: "Детали баков", categorySlug: "tanks" },
  ],
  brands: [{ slug: "kamaz", name: "КАМАЗ" }],
  vehicleTypes: [{ slug: "truck", name: "Грузовик" }],
  categoryBrands: { pto: ["kamaz"] },
  directProductCategorySlugs: ["fittings", "pumps", "tanks"],
  products: [
    {
      slug: "seal",
      name: "Уплотнение",
      category: "fittings",
      compatibleBrands: [],
      vehicleTypes: [],
      images: [{ url: "/images/seal.jpg" }],
      shortDescription: "Уплотнение",
      updatedAt: "2026-09-22T10:00:00Z",
    },
    {
      slug: "pump",
      name: "Насос",
      category: "pumps",
      subcategory: "parts",
      compatibleBrands: ["kamaz"],
      vehicleTypes: ["truck"],
      images: [{ url: "https://media.example/pump.jpg" }],
      shortDescription: "Насос",
      updatedAt: "2026-09-22T11:00:00Z",
    },
    {
      slug: "shaft",
      name: "Вал",
      category: "pto",
      compatibleBrands: ["kamaz"],
      vehicleTypes: [],
      images: [],
      shortDescription: "Вал",
      updatedAt: "2026-09-22T12:00:00Z",
    },
    {
      slug: "unrouted",
      name: "Без бренда",
      category: "pto",
      compatibleBrands: [],
      vehicleTypes: [],
      images: [],
      shortDescription: "Без бренда",
      updatedAt: "2026-09-22T13:00:00Z",
    },
  ],
});

function derive(source = snapshot()) {
  return derivePublicRoutes(source, siteUrl);
}

describe("framework-neutral public route derivation", () => {
  it("matches Next's slashless homepage canonical", () => {
    expect(derive().manifestEntries.find((entry) => entry.path === "/"))
      .toMatchObject({ class: "static", family: "home", expectedCanonical: siteUrl });
  });

  it("keeps product canonical, alias, and unresolved product distinct", () => {
    const entries = derive().manifestEntries;
    expect(entries.filter((entry) => entry.family === "product" || entry.family === "product-alias"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ class: "static", family: "product", path: "/catalog/category/fittings/seal" }),
        expect.objectContaining({ class: "static", family: "product", path: "/catalog/category/pumps/subcategory/parts/pump" }),
        expect.objectContaining({ class: "static", family: "product", path: "/catalog/category/pto/brand/kamaz/shaft" }),
        expect.objectContaining({ class: "redirect", family: "product-alias", path: "/product/pump", redirectTo: "/catalog/category/pumps/subcategory/parts/pump" }),
        // Production sends a product without a resolvable page to /catalog (getProductHref fallback).
        expect.objectContaining({ class: "redirect", family: "product-alias", path: "/product/unrouted", redirectTo: "/catalog", status: 308 }),
      ]));
  });

  it("mirrors production for a product with no resolvable page: alias to /catalog, no page, not in the sitemap", () => {
    const { manifestEntries, sitemapEntries } = derive();
    expect(manifestEntries.some((entry) => entry.class === "invalid")).toBe(false);
    expect(manifestEntries.filter((entry) => entry.snapshotIds.includes("unrouted") && entry.class === "static")).toEqual([]);
    expect(sitemapEntries.some((entry) => entry.path.includes("unrouted"))).toBe(false);
    expect(createRouteManifest("fixture", manifestEntries).ok).toBe(true);
  });

  it("keeps every brand-product URL served by a category-brand listing", () => {
    const source = snapshot();
    source.brands.push({ slug: "shacman", name: "SHACMAN" });
    source.categoryBrands.pto.push("shacman");
    source.products[2].compatibleBrands = ["kamaz", "shacman"];

    const { manifestEntries, sitemapEntries } = derive(source);
    const productPages = manifestEntries.filter((entry) => entry.family === "product" && entry.class === "static");
    expect(productPages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "/catalog/category/pto/brand/kamaz/shaft",
        expectedCanonical: `${siteUrl}/catalog/category/pto/brand/kamaz/shaft`,
      }),
      expect.objectContaining({
        path: "/catalog/category/pto/brand/shacman/shaft",
        expectedCanonical: `${siteUrl}/catalog/category/pto/brand/shacman/shaft`,
      }),
    ]));
    expect(sitemapEntries.filter((entry) => entry.path.endsWith("/shaft"))).toHaveLength(1);
    expect(createRouteManifest("fixture", manifestEntries).ok).toBe(true);
  });

  it("does not publish a product path whose subcategory belongs to another category", () => {
    const source = snapshot();
    source.subcategories = source.subcategories.filter((item) => item.categorySlug !== "pumps");

    const { manifestEntries, sitemapEntries } = derive(source);
    expect(manifestEntries).toContainEqual(expect.objectContaining({
      class: "invalid", family: "product", path: "/product/pump", reason: "snapshot_reference_invalid",
    }));
    expect(manifestEntries.some((entry) => entry.path === "/catalog/category/pumps/subcategory/parts/pump")).toBe(false);
    expect(sitemapEntries.some((entry) => entry.path === "/catalog/category/pumps/subcategory/parts/pump")).toBe(false);
  });

  it("derives each page family from real snapshot relations, including composite subcategories", () => {
    const routes = new Map(derive().manifestEntries.map((entry) => [entry.path, [entry.family, entry.class]]));
    expect([...routes]).toEqual(expect.arrayContaining([
      ["/", ["home", "static"]],
      ["/about", ["about", "static"]],
      ["/contacts", ["contacts", "static"]],
      ["/nsh-nasos", ["landing", "static"]],
      ["/nsh-nasos/na-samosval", ["landing", "static"]],
      ["/nsh-nasos/na-tonar", ["landing", "static"]],
      ["/nsh-nasos/na-manipulyator", ["landing", "static"]],
      ["/catalog", ["catalog", "query"]],
      ["/catalog/category/fittings", ["category", "query"]],
      ["/catalog/category/pumps", ["category", "query"]],
      ["/catalog/category/pto", ["category", "static"]],
      ["/catalog/category/pumps/subcategory/parts", ["subcategory", "query"]],
      ["/catalog/category/tanks/subcategory/parts", ["subcategory", "query"]],
      ["/catalog/brand/kamaz", ["brand", "static"]],
      ["/catalog/vehicle-type/truck", ["vehicle-type", "query"]],
      ["/catalog/category/pto/brand/kamaz", ["category-brand", "query"]],
      ["/catalog/brand/kamaz/category/pumps", ["brand-category", "static"]],
      ["/catalog/brand/kamaz/category/pumps/subcategory/parts", ["brand-category-subcategory", "query"]],
      ["/robots.txt", ["robots", "static"]],
      ["/sitemap.xml", ["sitemap", "static"]],
      ["/404", ["not-found", "static"]],
    ]));
    expect(routes.has("/catalog/brand/kamaz/category/pto")).toBe(false);
    expect(routes.has("/catalog/brand/kamaz/category/tanks")).toBe(false);
  });

  it("preserves legacy sitemap paths and metadata without navigation-only or invalid entries", () => {
    const entries = derive().sitemapEntries;
    expect(entries.map((entry) => entry.path)).toEqual([
      "/", "/catalog", "/about", "/contacts",
      "/nsh-nasos", "/nsh-nasos/na-samosval", "/nsh-nasos/na-tonar", "/nsh-nasos/na-manipulyator",
      "/catalog/category/fittings", "/catalog/category/pumps", "/catalog/category/tanks", "/catalog/category/pto",
      "/catalog/category/pumps/subcategory/parts", "/catalog/category/tanks/subcategory/parts",
      "/catalog/brand/kamaz", "/catalog/vehicle-type/truck", "/catalog/category/pto/brand/kamaz",
      "/catalog/category/fittings/seal", "/catalog/category/pumps/subcategory/parts/pump",
      "/catalog/category/pto/brand/kamaz/shaft",
    ]);
    expect(entries.find((entry) => entry.path === "/catalog/category/fittings/seal")).toEqual({
      path: "/catalog/category/fittings/seal",
      changeFrequency: "weekly",
      priority: 0.8,
      lastModified: "2026-09-22T10:00:00Z",
      images: [`${siteUrl}/images/seal.jpg`],
    });
    expect(entries.find((entry) => entry.path === "/catalog/category/pumps/subcategory/parts/pump")?.images)
      .toEqual(["https://media.example/pump.jpg"]);
    expect(entries.find((entry) => entry.path === "/catalog/category/pto/brand/kamaz/shaft")?.images)
      .toBeUndefined();
    expect(entries.find((entry) => entry.path === "/catalog")?.changeFrequency).toBe("daily");
  });

  it("produces a valid manifest and every sitemap path has one page entry", () => {
    const { manifestEntries, sitemapEntries } = derive();
    const manifest = createRouteManifest("fixture", manifestEntries);
    expect(manifest.ok).toBe(true);
    for (const sitemapEntry of sitemapEntries) {
      expect(manifestEntries.filter((entry) => entry.path === sitemapEntry.path &&
        (entry.class === "static" || entry.class === "query"))).toHaveLength(1);
    }
  });

  it("no longer blocks mixed-category pagination now that the public search API and client pagination exist", () => {
    const { blockers, manifestEntries, sitemapEntries } = derive();
    expect(blockers).toEqual([]);
    expect(manifestEntries).toContainEqual(
      expect.objectContaining({ family: "category", class: "query", path: "/catalog/category/pumps" }),
    );
    expect(manifestEntries).toContainEqual(
      expect.objectContaining({ family: "category", class: "query", path: "/catalog/category/tanks" }),
    );
    expect(sitemapEntries.some((entry) => entry.path === "/catalog/category/pumps")).toBe(true);
    expect(sitemapEntries.some((entry) => entry.path === "/catalog/category/tanks")).toBe(true);
  });

  it("serializes the same manifest regardless of input ordering", () => {
    const first = snapshot();
    const reversed = snapshot();
    reversed.categories.reverse();
    reversed.subcategories.reverse();
    reversed.products.reverse();
    const firstManifest = createRouteManifest("fixture", derive(first).manifestEntries);
    const secondManifest = createRouteManifest("fixture", derive(reversed).manifestEntries);
    expect(firstManifest.ok).toBe(true);
    expect(secondManifest.ok).toBe(true);
    if (!firstManifest.ok || !secondManifest.ok) return;
    expect(serializeRouteManifest(firstManifest.value)).toBe(serializeRouteManifest(secondManifest.value));
  });
});
