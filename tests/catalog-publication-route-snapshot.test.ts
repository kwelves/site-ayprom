import { describe, expect, it } from "vitest";
import { catalogSnapshotFromPublication } from "@/cloudflare/static-build/producer/catalog-publication-route-snapshot";
import { derivePublicRoutes } from "@/cloudflare/static-build/derive-routes";
import type { CatalogPublicationExport } from "@/cloudflare/static-build/producer/catalog-publication-export";

const releaseId = "20000000-0000-4000-8000-000000000001";
const publication: CatalogPublicationExport = {
  format: 1, releaseId, revision: 5, sha256: "a".repeat(64), documentCount: 7,
  documents: {
    category: [{ slug: "pto", name: "PTO", type: "brand" }],
    subcategory: [],
    brand: [{ slug: "kamaz", name: "Kamaz" }, { slug: "shacman", name: "Shacman" }],
    category_brand: [
      { category_slug: "pto", brand_slug: "kamaz" },
      { category_slug: "pto", brand_slug: "shacman" },
    ],
    vehicle_type: [{ slug: "truck", name: "Truck" }],
    vehicle_hotspot: [],
    product: [{ slug: "shaft", name: "Shaft", category_slug: "pto", short_description: "short",
      article: null, updated_at: "2026-01-01T00:00:00Z", subcategories: null,
      product_brands: [{ brands: { slug: "shacman" } }, { brands: { slug: "kamaz" } }],
      product_vehicle_types: [{ vehicle_type_slug: "truck" }],
      product_images: [{ url: "https://media.example/shaft.jpg", scale: 1, order: 1 }] }],
  },
};

describe("route manifest from the same pinned release", () => {
  it("derives both brand URLs and one canonical sitemap URL from the export", () => {
    const snapshot = catalogSnapshotFromPublication(publication);
    expect(snapshot.snapshotId).toBe(releaseId);
    expect(snapshot.products[0].images).toEqual([{ url: "https://media.example/shaft.jpg", scale: 1 }]);
    const routes = derivePublicRoutes(snapshot, "https://www.ayprom-gidravlika.kg");
    expect(routes.blockers).toEqual([]);
    const paths = routes.manifestEntries.map((entry) => entry.path);
    expect(paths).toContain("/catalog/category/pto/brand/kamaz/shaft");
    expect(paths).toContain("/catalog/category/pto/brand/shacman/shaft");
    expect(routes.sitemapEntries.map((entry) => entry.path))
      .toContain("/catalog/category/pto/brand/kamaz/shaft");
  });

  it("fails closed if a captured relation is missing", () => {
    const broken = { ...publication, documents: { ...publication.documents, brand: [] } };
    expect(() => catalogSnapshotFromPublication(broken)).toThrow("Catalog route snapshot unavailable");
  });
});
