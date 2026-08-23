import { describe, expect, it } from "vitest";
import {
  HOTSPOTS_PER_VEHICLE,
  parseSerializedVehicleHotspotUpdates,
  parseVehicleHotspotUndoUpdates,
  parseVehicleHotspotUpdates,
} from "@/lib/admin/vehicle-hotspot-updates";

function updates() {
  return Array.from({ length: HOTSPOTS_PER_VEHICLE }, (_, index) => ({
    id: `hotspot-${index + 1}`,
    label: ` Точка ${index + 1} `,
    productId: index === 0 ? "product-1" : null,
  }));
}

describe("parseVehicleHotspotUpdates", () => {
  it("нормализует название и принимает только полный пакет из пяти точек", () => {
    expect(parseVehicleHotspotUpdates(updates())).toEqual(
      updates().map((update) => ({ ...update, label: update.label.trim() })),
    );
    expect(() => parseVehicleHotspotUpdates(updates().slice(0, -1))).toThrow("ровно 5 хотспотов");
  });

  it("отклоняет повторные точки и пустые названия, но принимает повторный товар", () => {
    const duplicateHotspot = updates();
    duplicateHotspot[1].id = duplicateHotspot[0].id;
    expect(() => parseVehicleHotspotUpdates(duplicateHotspot)).toThrow("Один и тот же хотспот");

    const duplicateProduct = updates();
    duplicateProduct[1].productId = "product-1";
    expect(parseVehicleHotspotUpdates(duplicateProduct)[1]?.productId).toBe("product-1");

    const blankLabel = updates();
    blankLabel[0].label = "  ";
    expect(() => parseVehicleHotspotUpdates(blankLabel)).toThrow("Заполните названия");
  });
});

describe("parseSerializedVehicleHotspotUpdates", () => {
  it("применяет те же правила к не доверяемому сериализованному Undo-пакету", () => {
    expect(parseSerializedVehicleHotspotUpdates(JSON.stringify(updates()))).toHaveLength(HOTSPOTS_PER_VEHICLE);
    expect(() => parseSerializedVehicleHotspotUpdates("not-json")).toThrow("неверный формат");
    expect(() => parseSerializedVehicleHotspotUpdates({})).toThrow("Не удалось прочитать");
  });

  it("применяет те же правила к структурированному значению Server Action", () => {
    expect(parseVehicleHotspotUndoUpdates(updates())).toHaveLength(HOTSPOTS_PER_VEHICLE);
  });
});
