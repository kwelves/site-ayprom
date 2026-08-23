import { describe, expect, it } from "vitest";
import {
  getProductHotspotAssignmentRpcErrorMessage,
  parseProductHotspotAssignmentUpdates,
} from "@/lib/admin/product-hotspot-assignments";

const HOTSPOT_ONE = "11111111-1111-4111-8111-111111111111";
const HOTSPOT_TWO = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ONE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_TWO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("parseProductHotspotAssignmentUpdates", () => {
  it("принимает одно или два полных CAS-изменения", () => {
    const updates = [
      { hotspotId: HOTSPOT_ONE, expectedProductId: null, productId: PRODUCT_ONE },
      { hotspotId: HOTSPOT_TWO, expectedProductId: PRODUCT_TWO, productId: null },
    ];

    expect(parseProductHotspotAssignmentUpdates(updates)).toEqual(updates);
    expect(parseProductHotspotAssignmentUpdates(updates.slice(0, 1))).toEqual(updates.slice(0, 1));
  });

  it("отклоняет пустой, слишком большой и повторяющий точку пакет", () => {
    expect(() => parseProductHotspotAssignmentUpdates([])).toThrow("одно или два");
    expect(() =>
      parseProductHotspotAssignmentUpdates([
        { hotspotId: HOTSPOT_ONE, expectedProductId: null, productId: PRODUCT_ONE },
        { hotspotId: HOTSPOT_TWO, expectedProductId: null, productId: PRODUCT_TWO },
        { hotspotId: "33333333-3333-4333-8333-333333333333", expectedProductId: null, productId: null },
      ]),
    ).toThrow("одно или два");
    expect(() =>
      parseProductHotspotAssignmentUpdates([
        { hotspotId: HOTSPOT_ONE, expectedProductId: null, productId: PRODUCT_ONE },
        { hotspotId: HOTSPOT_ONE, expectedProductId: PRODUCT_ONE, productId: null },
      ]),
    ).toThrow("Один и тот же хотспот");
  });

  it("строго проверяет UUID, nullable-поля и точный набор ключей", () => {
    expect(() =>
      parseProductHotspotAssignmentUpdates([
        { hotspotId: "not-a-uuid", expectedProductId: null, productId: PRODUCT_ONE },
      ]),
    ).toThrow("Идентификатор хотспота");
    expect(() =>
      parseProductHotspotAssignmentUpdates([
        { hotspotId: HOTSPOT_ONE, expectedProductId: undefined, productId: PRODUCT_ONE },
      ]),
    ).toThrow("Ожидаемый товар");
    expect(() =>
      parseProductHotspotAssignmentUpdates([
        { hotspotId: HOTSPOT_ONE, expectedProductId: null, productId: PRODUCT_ONE, extra: true },
      ]),
    ).toThrow("неверный набор полей");
  });
});

describe("getProductHotspotAssignmentRpcErrorMessage", () => {
  it.each([
    "Hotspot assignment state has changed",
    "Every selected hotspot must exist",
  ])("переводит конфликт %s в единое безопасное сообщение", (message) => {
    expect(getProductHotspotAssignmentRpcErrorMessage(message)).toBe(
      "Данные хотспотов изменены другим администратором. Обновите страницу и повторите действие.",
    );
  });

  it("не скрывает неизвестную ошибку базы общим конфликтом", () => {
    expect(getProductHotspotAssignmentRpcErrorMessage("unexpected database failure")).toBeNull();
  });
});
