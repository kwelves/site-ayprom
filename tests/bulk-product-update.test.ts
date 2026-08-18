import { describe, expect, it } from "vitest";
import { buildBulkProductUpdateFields, normalizeBulkProductSlugs } from "@/lib/admin/bulk-product-update";

describe("normalizeBulkProductSlugs", () => {
  it("убирает дубликаты и пустые значения", () => {
    expect(normalizeBulkProductSlugs(["a", "b", "a", "  ", ""])).toEqual(["a", "b"]);
  });

  it("обрезает пробелы", () => {
    expect(normalizeBulkProductSlugs([" a ", "b"])).toEqual(["a", "b"]);
  });

  it("возвращает пустой массив для пустого выделения", () => {
    expect(normalizeBulkProductSlugs([])).toEqual([]);
  });
});

describe("buildBulkProductUpdateFields", () => {
  it("собирает только переданные поля", () => {
    expect(buildBulkProductUpdateFields({ published: true })).toEqual({ published: true });
    expect(buildBulkProductUpdateFields({ availability: "out_of_stock" })).toEqual({ availability: "out_of_stock" });
  });

  it("собирает оба поля вместе", () => {
    expect(buildBulkProductUpdateFields({ published: false, availability: "unclear" })).toEqual({
      published: false,
      availability: "unclear",
    });
  });

  it("возвращает null для пустого патча — вызывающий код должен пропустить запрос", () => {
    expect(buildBulkProductUpdateFields({})).toBeNull();
  });

  it("отклоняет недопустимый статус наличия", () => {
    // @ts-expect-error намеренно недопустимое значение — эмулирует прямой вызов Server Action
    expect(() => buildBulkProductUpdateFields({ availability: "in-stock" })).toThrow();
  });
});
