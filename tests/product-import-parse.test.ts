import { describe, expect, it } from "vitest";
import { parseProductImportCsv, type ImportCatalogReference } from "@/lib/admin/product-import-parse";

function makeReference(overrides: Partial<ImportCatalogReference> = {}): ImportCatalogReference {
  return {
    categorySlugs: new Set(["hydraulic-pumps"]),
    subcategoriesByCategory: new Map([["hydraulic-pumps", new Map([["gear-pumps", "sub-id-1"]])]]),
    brandSlugs: new Set(["daf", "man"]),
    vehicleTypeSlugs: new Set(["samosval"]),
    existingSlugs: new Set(["ay-gp110"]),
    articleToSlug: new Map([["EXIST-1", "ay-gp110"]]),
    ...overrides,
  };
}

const HEADER = "name,article,category,subcategory,short_description,description,published,brands,vehicle_types,characteristics";

describe("parseProductImportCsv", () => {
  it("сообщает об отсутствующих обязательных колонках, не читая строки", () => {
    const result = parseProductImportCsv("name,category\nX,hydraulic-pumps", makeReference());
    expect(result.validRows).toEqual([]);
    expect(result.errors[0].message).toContain("short_description");
  });

  it("новый товар получает сгенерированный slug и action создания", () => {
    const csv = `${HEADER}\nНовый насос,,hydraulic-pumps,,Кратко,,,,,`;
    const result = parseProductImportCsv(csv, makeReference());
    expect(result.errors).toEqual([]);
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0]).toMatchObject({ slug: "novyy-nasos", matchedExisting: false });
  });

  it("товар с известным article наследует существующий slug и матчится на обновление", () => {
    const csv = `${HEADER}\nОбновлённый насос,EXIST-1,hydraulic-pumps,,Кратко,,,,,`;
    const result = parseProductImportCsv(csv, makeReference());
    expect(result.validRows[0]).toMatchObject({ slug: "ay-gp110", matchedExisting: true });
  });

  it("неизвестная категория даёт ошибку и строка не попадает в validRows", () => {
    const csv = `${HEADER}\nX,,no-such-category,,Кратко,,,,,`;
    const result = parseProductImportCsv(csv, makeReference());
    expect(result.validRows).toEqual([]);
    expect(result.errors[0].message).toContain("Неизвестная категория");
  });

  it("подкатегория проверяется в связке с категорией, а не сама по себе", () => {
    const csv = `${HEADER}\nX,,hydraulic-pumps,no-such-sub,Кратко,,,,,`;
    const result = parseProductImportCsv(csv, makeReference());
    expect(result.errors[0].message).toContain("Подкатегория");
  });

  it("неизвестный бренд в списке через ';' даёт ошибку", () => {
    const csv = `${HEADER}\nX,,hydraulic-pumps,,Кратко,,,unknown-brand;daf,,`;
    const result = parseProductImportCsv(csv, makeReference());
    expect(result.errors[0].message).toContain("unknown-brand");
  });

  it("два новых товара с одинаковым именем в одном файле получают разные slug", () => {
    const csv = `${HEADER}\nПовтор,,hydraulic-pumps,,Кратко,,,,,\nПовтор,,hydraulic-pumps,,Кратко,,,,,`;
    const result = parseProductImportCsv(csv, makeReference());
    expect(result.validRows.map((r) => r.slug)).toEqual(["povtor", "povtor-2"]);
  });

  it("повторяющийся article в одном файле — ошибка на второй строке", () => {
    const csv = `${HEADER}\nA,DUP-1,hydraulic-pumps,,Кратко,,,,,\nB,DUP-1,hydraulic-pumps,,Кратко,,,,,`;
    const result = parseProductImportCsv(csv, makeReference());
    expect(result.validRows).toHaveLength(1);
    expect(result.errors[0].message).toContain("повторяется");
  });

  it("published распознаёт русские и английские отрицания, пустое — true", () => {
    const csv = `${HEADER}\nA,,hydraulic-pumps,,K,,false,,,\nB,,hydraulic-pumps,,K,,нет,,,\nC,,hydraulic-pumps,,K,,,,,`;
    const result = parseProductImportCsv(csv, makeReference());
    expect(result.validRows.map((r) => r.published)).toEqual([false, false, true]);
  });

  it("characteristics разбирает пары attribute=value через ';'", () => {
    const csv = `${HEADER}\nA,,hydraulic-pumps,,K,,,,,"Давление=250 бар;Вес=12 кг"`;
    const result = parseProductImportCsv(csv, makeReference());
    expect(result.validRows[0].characteristics).toEqual([
      { attribute: "Давление", value: "250 бар" },
      { attribute: "Вес", value: "12 кг" },
    ]);
  });

  it("одна плохая строка не мешает валидным строкам того же файла", () => {
    const csv = `${HEADER}\nX,,no-such-category,,K,,,,,\nY,,hydraulic-pumps,,K,,,,,`;
    const result = parseProductImportCsv(csv, makeReference());
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0].name).toBe("Y");
    expect(result.errors).toHaveLength(1);
  });
});
