import { describe, expect, it } from "vitest";
import { parseAdminPage } from "@/lib/admin/pagination";

// Номер страницы приходит из строки запроса и потому неконтролируем. Любое
// значение, кроме положительного целого, должно давать первую страницу:
// отрицательный сдвиг ушёл бы в range() и уронил бы запрос вместо показа
// списка товаров.
describe("parseAdminPage", () => {
  it("возвращает номер страницы для положительного целого", () => {
    expect(parseAdminPage("3")).toBe(3);
  });

  it("сводит к первой странице отсутствующее и пустое значение", () => {
    expect(parseAdminPage(undefined)).toBe(1);
    expect(parseAdminPage("")).toBe(1);
  });

  it("сводит к первой странице ноль и отрицательные значения", () => {
    expect(parseAdminPage("0")).toBe(1);
    expect(parseAdminPage("-5")).toBe(1);
  });

  it("сводит к первой странице дробное и нечисловое", () => {
    expect(parseAdminPage("2.5")).toBe(1);
    expect(parseAdminPage("abc")).toBe(1);
    expect(parseAdminPage("1; drop table products")).toBe(1);
  });
});
