import { describe, expect, it } from "vitest";
import {
  validateCatalogSnapshot,
  type CatalogSnapshot,
} from "@/cloudflare/static-build/snapshot";

const validSnapshot = (): CatalogSnapshot => ({
  schemaVersion: 1,
  snapshotId: "fixture-2026-09-22",
  categories: [{ slug: "pumps", name: "Насосы", type: "subcategory" }],
  subcategories: [
    { slug: "gear", name: "Шестерённые", categorySlug: "pumps" },
  ],
  brands: [{ slug: "kamaz", name: "КАМАЗ" }],
  vehicleTypes: [{ slug: "truck", name: "Грузовик" }],
  categoryBrands: { pumps: ["kamaz"] },
  directProductCategorySlugs: ["pumps"],
  products: [
    {
      slug: "nsh-32",
      name: "НШ-32",
      category: "pumps",
      subcategory: "gear",
      compatibleBrands: ["kamaz"],
      vehicleTypes: ["truck"],
      images: [
        { url: "https://media.ayprom-gidravlika.kg/nsh-32.webp" },
      ],
      shortDescription: "Насос",
      updatedAt: "2026-09-22T00:00:00.000Z",
    },
  ],
});

it.each([
  "2026-09-22T00:00:00+00:00",
  "2026-09-22T00:00:00Z",
  "2026-09-22T00:00:00.123456+06:00",
])("accepts valid ISO timestamp %s without normalizing it", (timestamp) => {
  const snapshot = validSnapshot();
  snapshot.products[0].updatedAt = timestamp;
  expect(validateCatalogSnapshot(snapshot)).toEqual({ ok: true, value: snapshot });
});

// Real production data: 70 of 88 products have an empty short description (the column is NOT NULL).
it.each(["", "   "])("accepts a product with an empty short description %j without changing it", (empty) => {
  const snapshot = validSnapshot();
  snapshot.products[0].shortDescription = empty;
  expect(validateCatalogSnapshot(snapshot)).toEqual({ ok: true, value: snapshot });
});

it.each([null, 7, undefined])("still rejects a non-string short description %j", (value) => {
  const snapshot = validSnapshot();
  (snapshot.products[0] as unknown as Record<string, unknown>).shortDescription = value;
  expect(validateCatalogSnapshot(snapshot)).toMatchObject({
    ok: false,
    issues: expect.arrayContaining([{ field: "products[0].shortDescription", rule: "string_required" }]),
  });
});

it("rejects an impossible ISO calendar date", () => {
  const snapshot = validSnapshot();
  snapshot.products[0].updatedAt = "2026-02-30T00:00:00Z";
  expect(validateCatalogSnapshot(snapshot)).toMatchObject({
    ok: false,
    issues: expect.arrayContaining([
      { field: "products[0].updatedAt", rule: "invalid_timestamp" },
    ]),
  });
});

type InvalidSnapshotCase = readonly [
  name: string,
  mutate: (snapshot: CatalogSnapshot) => void,
  field: string,
  rule: string,
];

const invalidRelationCases: InvalidSnapshotCase[] = [
  [
    "duplicate category",
    (snapshot) => snapshot.categories.push({ ...snapshot.categories[0] }),
    "categories[1].slug",
    "duplicate_slug",
  ],
  [
    "duplicate product",
    (snapshot) => snapshot.products.push({ ...snapshot.products[0] }),
    "products[1].slug",
    "duplicate_slug",
  ],
  [
    "missing product category",
    (snapshot) => {
      snapshot.products[0].category = "missing";
    },
    "products[0].category",
    "unknown_category",
  ],
  [
    "wrong subcategory parent",
    (snapshot) => {
      snapshot.subcategories[0].categorySlug = "missing";
    },
    "subcategories[0].categorySlug",
    "unknown_category",
  ],
  [
    "missing product subcategory",
    (snapshot) => {
      snapshot.products[0].subcategory = "missing";
    },
    "products[0].subcategory",
    "unknown_subcategory",
  ],
  [
    "missing compatible brand",
    (snapshot) => {
      snapshot.products[0].compatibleBrands = ["missing"];
    },
    "products[0].compatibleBrands[0]",
    "unknown_brand",
  ],
  [
    "missing vehicle type",
    (snapshot) => {
      snapshot.products[0].vehicleTypes = ["missing"];
    },
    "products[0].vehicleTypes[0]",
    "unknown_vehicle_type",
  ],
  [
    "missing category-brand category",
    (snapshot) => {
      snapshot.categoryBrands = { missing: ["kamaz"] };
    },
    "categoryBrands.missing",
    "unknown_category",
  ],
  [
    "missing category-brand brand",
    (snapshot) => {
      snapshot.categoryBrands = { pumps: ["missing"] };
    },
    "categoryBrands.pumps[0]",
    "unknown_brand",
  ],
  [
    "missing direct-product category",
    (snapshot) => {
      snapshot.directProductCategorySlugs = ["missing"];
    },
    "directProductCategorySlugs[0]",
    "unknown_category",
  ],
  [
    "duplicate compatible brand",
    (snapshot) => {
      snapshot.products[0].compatibleBrands = ["kamaz", "kamaz"];
    },
    "products[0].compatibleBrands[1]",
    "duplicate_reference",
  ],
];

describe("catalog snapshot contract", () => {
  it("accepts a complete frozen snapshot", () => {
    const snapshot = validSnapshot();
    expect(validateCatalogSnapshot(snapshot)).toEqual({
      ok: true,
      value: snapshot,
    });
  });

  it("accepts the same subcategory slug in different parent categories", () => {
    const snapshot = validSnapshot();
    snapshot.categories.push({ slug: "tanks", name: "Баки", type: "subcategory" });
    snapshot.subcategories.push({
      slug: "gear",
      name: "Шестерённые для баков",
      categorySlug: "tanks",
    });
    snapshot.products.push({
      ...snapshot.products[0],
      slug: "tank-gear",
      category: "tanks",
    });

    expect(validateCatalogSnapshot(snapshot)).toEqual({ ok: true, value: snapshot });
  });

  it.each(invalidRelationCases)("rejects %s", (_name, mutate, field, rule) => {
    const snapshot = validSnapshot();
    mutate(snapshot);
    expect(validateCatalogSnapshot(snapshot)).toMatchObject({
      ok: false,
      code: "snapshot_invalid",
      issues: expect.arrayContaining([{ field, rule }]),
    });
  });

  it("rejects a product subcategory owned by another category", () => {
    const snapshot = validSnapshot();
    snapshot.categories.push({ slug: "tanks", name: "Баки", type: "subcategory" });
    snapshot.subcategories.push({
      slug: "oil",
      name: "Масляные",
      categorySlug: "tanks",
    });
    snapshot.products[0].subcategory = "oil";

    expect(validateCatalogSnapshot(snapshot)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        { field: "products[0].subcategory", rule: "subcategory_category_mismatch" },
      ]),
    });
  });

  it("rejects slash-containing slugs and invalid timestamps", () => {
    const snapshot = validSnapshot();
    snapshot.products[0].slug = "bad/slug";
    snapshot.products[0].updatedAt = "yesterday";

    expect(validateCatalogSnapshot(snapshot)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        { field: "products[0].slug", rule: "invalid_slug" },
        { field: "products[0].updatedAt", rule: "invalid_timestamp" },
      ]),
    });
  });

  it("rejects malformed unknown input without throwing or echoing values", () => {
    const result = validateCatalogSnapshot({
      schemaVersion: 2,
      products: "secret-value",
    });
    expect(result).toMatchObject({
      ok: false,
      code: "snapshot_invalid",
      issues: expect.arrayContaining([
        { field: "schemaVersion", rule: "unsupported_schema" },
      ]),
    });
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });
});
