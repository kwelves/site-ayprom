import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyOptimisticProductPatch } from "@/components/admin/product-publication-state";
import type { AdminProductHotspotOption, AdminProductListItem } from "@/lib/admin/queries";

function product(id: string, slug: string, hotspotId: string | null): AdminProductListItem {
  return {
    id,
    slug,
    name: slug,
    categoryName: "Категория",
    shortDescription: "Описание",
    published: true,
    availability: "in_stock",
    hotspotCount: hotspotId ? 1 : 0,
    hotspotAssignment: hotspotId
      ? {
          id: hotspotId,
          vehicleTypeSlug: "dump-truck",
          vehicleTypeName: "Самосвал",
          hotspotNumber: Number(hotspotId.at(-1)),
          label: `Точка ${hotspotId.at(-1)}`,
        }
      : null,
    order: 0,
    updatedAt: "2026-08-22T00:00:00.000Z",
    coverImage: null,
  };
}

function hotspot(id: string, assignedProduct: AdminProductListItem | null): AdminProductHotspotOption {
  return {
    id,
    vehicleTypeSlug: "dump-truck",
    vehicleTypeName: "Самосвал",
    vehicleTypeOrder: 0,
    hotspotNumber: Number(id.at(-1)),
    label: `Точка ${id.at(-1)}`,
    xPct: 50,
    yPct: 50,
    product: assignedProduct
      ? { id: assignedProduct.id, slug: assignedProduct.slug, name: assignedProduct.name }
      : null,
  };
}

const productsListSource = readFileSync(
  fileURLToPath(new URL("../src/components/admin/ProductsList.tsx", import.meta.url)),
  "utf8",
);

describe("optimistic unpublish state", () => {
  it("при одиночном снятии публикации очищает assignment, count и занятость точки", () => {
    const first = product("product-1", "first", "hotspot-1");
    const second = product("product-2", "second", "hotspot-2");
    const products = [first, second];
    const options = [hotspot("hotspot-1", first), hotspot("hotspot-2", second)];
    const originalProducts = structuredClone(products);
    const originalOptions = structuredClone(options);

    const result = applyOptimisticProductPatch(products, options, [first.slug], { published: false });

    expect(result.products[0]).toMatchObject({ published: false, hotspotAssignment: null, hotspotCount: 0 });
    expect(result.hotspotOptions[0]?.product).toBeNull();
    expect(result.products[1]).toBe(second);
    expect(result.hotspotOptions[1]).toBe(options[1]);
    expect(products).toEqual(originalProducts);
    expect(options).toEqual(originalOptions);
  });

  it("при массовом снятии публикации очищает только все выбранные закрепления", () => {
    const first = product("product-1", "first", "hotspot-1");
    const second = product("product-2", "second", "hotspot-2");
    const third = product("product-3", "third", "hotspot-3");
    const products = [first, second, third];
    const options = [hotspot("hotspot-1", first), hotspot("hotspot-2", second), hotspot("hotspot-3", third)];

    const result = applyOptimisticProductPatch(products, options, [first.slug, third.slug], { published: false });

    expect(result.products.map((item) => [item.published, item.hotspotCount])).toEqual([
      [false, 0],
      [true, 1],
      [false, 0],
    ]);
    expect(result.hotspotOptions.map((item) => item.product?.id ?? null)).toEqual([null, second.id, null]);
  });

  it("сохраняет обе исходные ссылки как rollback snapshot в одиночном и массовом обработчиках", () => {
    expect(productsListSource.match(/setProducts\(previousProducts\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(productsListSource.match(/setHotspotOptions\(previousHotspotOptions\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(productsListSource).toContain("toggleProductPublished(product.slug, nextPublished, confirmedUnpublish)");
    expect(productsListSource).toContain("bulkUpdateProducts(slugs, patch)");
  });

  it("не отвязывает хотспот при публикации или изменении наличия", () => {
    const first = product("product-1", "first", "hotspot-1");
    const options = [hotspot("hotspot-1", first)];

    const publish = applyOptimisticProductPatch([{ ...first, published: false }], options, [first.slug], {
      published: true,
    });
    const availability = applyOptimisticProductPatch([first], options, [first.slug], { availability: "unclear" });

    expect(publish.products[0]?.hotspotAssignment).toEqual(first.hotspotAssignment);
    expect(publish.hotspotOptions).toBe(options);
    expect(availability.products[0]?.hotspotAssignment).toEqual(first.hotspotAssignment);
    expect(availability.hotspotOptions).toBe(options);
  });
});
