import { describe, expect, it } from "vitest";
import { parseProductImportCsv, type ImportCatalogReference } from "@/lib/admin/product-import-parse";

// Сквозная проверка форм-фактора, который реально уходит в RPC
// import_products_batch: от сырого CSV-текста до аргументов вызова, минуя
// лишь сам поход в БД (её отдельно проверяет product-import-parse.test.ts +
// ручной прогон RPC на живом Postgres при разработке миграции).
describe("CSV -> аргументы import_products_batch", () => {
  const reference: ImportCatalogReference = {
    categorySlugs: new Set(["hydraulic-pumps"]),
    subcategoriesByCategory: new Map([["hydraulic-pumps", new Map([["gear-pumps", "11111111-1111-1111-1111-111111111111"]])]]),
    brandSlugs: new Set(["daf", "man"]),
    vehicleTypeSlugs: new Set(["samosval"]),
    existingSlugs: new Set(["ay-gp110"]),
    articleToSlug: new Map([["EXIST-1", "ay-gp110"]]),
  };

  it("реалистичный файл с созданием, обновлением и характеристиками даёт корректную форму для RPC", () => {
    const csv = [
      "name,article,category,subcategory,short_description,description,published,brands,vehicle_types,characteristics",
      'Новый гидронасос,NEW-1,hydraulic-pumps,gear-pumps,Краткое описание,Полное описание,true,daf;man,samosval,"Давление=250 бар;Вес=12 кг"',
      "Обновлённый насос AY-GP110,EXIST-1,hydraulic-pumps,,Обновлено импортом,,false,,,",
    ].join("\n");

    const { validRows, errors } = parseProductImportCsv(csv, reference);
    expect(errors).toEqual([]);
    expect(validRows).toHaveLength(2);

    const rpcRows = validRows.map((row) => ({
      row_index: row.rowIndex,
      article: row.article,
      name: row.name,
      slug: row.slug,
      category_slug: row.categorySlug,
      subcategory_id: row.subcategoryId,
      short_description: row.shortDescription,
      description: row.description,
      published: row.published,
      brand_slugs: row.brandSlugs,
      vehicle_type_slugs: row.vehicleTypeSlugs,
      characteristics: row.characteristics,
    }));

    expect(rpcRows[0]).toEqual({
      row_index: 0,
      article: "NEW-1",
      name: "Новый гидронасос",
      slug: "novyy-gidronasos",
      category_slug: "hydraulic-pumps",
      subcategory_id: "11111111-1111-1111-1111-111111111111",
      short_description: "Краткое описание",
      description: "Полное описание",
      published: true,
      brand_slugs: ["daf", "man"],
      vehicle_type_slugs: ["samosval"],
      characteristics: [
        { attribute: "Давление", value: "250 бар" },
        { attribute: "Вес", value: "12 кг" },
      ],
    });

    expect(rpcRows[1]).toEqual({
      row_index: 1,
      article: "EXIST-1",
      name: "Обновлённый насос AY-GP110",
      slug: "ay-gp110",
      category_slug: "hydraulic-pumps",
      subcategory_id: null,
      short_description: "Обновлено импортом",
      description: null,
      published: false,
      brand_slugs: [],
      vehicle_type_slugs: [],
      characteristics: [],
    });
  });

  it("файл только с ошибками не даёт ни одной строки для RPC", () => {
    const csv = [
      "name,category,short_description",
      "X,no-such-category,Кратко",
    ].join("\n");

    const { validRows, errors } = parseProductImportCsv(csv, reference);
    expect(validRows).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});
