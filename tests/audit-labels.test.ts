import { describe, expect, it } from "vitest";
import { auditActionLabel, auditEntityLabel, auditChangedFieldsLabel, auditFieldDiffs, formatAuditValue } from "@/lib/admin/audit-labels";

describe("auditEntityLabel", () => {
  it("переводит имя таблицы в термин админки", () => {
    expect(auditEntityLabel("product_characteristics")).toBe("Характеристики");
    expect(auditEntityLabel("vehicle_hotspots")).toBe("Хотспоты спецтехники");
  });

  // Набор таблиц под аудитом задан триггерами в миграции и может измениться
  // без правки этого словаря. Незнакомое имя должно быть видно как есть,
  // а не превращаться в пустую ячейку.
  it("показывает незнакомую таблицу как есть", () => {
    expect(auditEntityLabel("future_table")).toBe("future_table");
  });
});

describe("auditActionLabel", () => {
  it("переводит известные действия", () => {
    expect(auditActionLabel("INSERT")).toBe("Создание");
    expect(auditActionLabel("DELETE")).toBe("Удаление");
  });

  it("показывает незнакомое действие как есть", () => {
    expect(auditActionLabel("TRUNCATE")).toBe("TRUNCATE");
  });
});

// Триггер записывает служебные значения 'created'/'deleted' вместо списка
// колонок для вставки и удаления — перечислять там нечего. Показывать их
// пользователю как названия полей нельзя.
describe("auditChangedFieldsLabel", () => {
  it("не показывает служебное значение для вставки", () => {
    expect(auditChangedFieldsLabel("INSERT", ["created"])).toBe("запись создана");
  });

  it("не показывает служебное значение для удаления", () => {
    expect(auditChangedFieldsLabel("DELETE", ["deleted"])).toBe("запись удалена");
  });

  it("перечисляет реально изменившиеся поля", () => {
    expect(auditChangedFieldsLabel("UPDATE", ["name", "published"])).toBe("name, published");
  });

  it("описывает изменение без затронутых полей", () => {
    expect(auditChangedFieldsLabel("UPDATE", [])).toBe("без изменений полей");
  });
});

// Записи до миграции before/after не содержат old_values/new_values — UI
// обязан деградировать до простого списка полей, а не падать или показывать
// пустой диф.
describe("auditFieldDiffs", () => {
  it("возвращает null для записей без before/after (до миграции)", () => {
    expect(auditFieldDiffs({ action: "UPDATE", changedFields: ["name"], oldValues: null, newValues: null })).toBeNull();
  });

  it("строит диф по изменённым полям для UPDATE", () => {
    expect(
      auditFieldDiffs({
        action: "UPDATE",
        changedFields: ["name", "published"],
        oldValues: { name: "Старое", published: true },
        newValues: { name: "Новое", published: false },
      }),
    ).toEqual([
      { field: "name", before: "Старое", after: "Новое" },
      { field: "published", before: true, after: false },
    ]);
  });

  it("возвращает null для UPDATE без затронутых полей", () => {
    expect(auditFieldDiffs({ action: "UPDATE", changedFields: [], oldValues: {}, newValues: {} })).toBeNull();
  });

  it("строит снимок new_values для INSERT", () => {
    expect(
      auditFieldDiffs({ action: "INSERT", changedFields: ["created"], oldValues: null, newValues: { name: "Товар" } }),
    ).toEqual([{ field: "name", before: null, after: "Товар" }]);
  });

  it("строит снимок old_values для DELETE", () => {
    expect(
      auditFieldDiffs({ action: "DELETE", changedFields: ["deleted"], oldValues: { name: "Товар" }, newValues: null }),
    ).toEqual([{ field: "name", before: "Товар", after: null }]);
  });
});

describe("formatAuditValue", () => {
  it("показывает прочерк для null/undefined/пустой строки", () => {
    expect(formatAuditValue(null)).toBe("—");
    expect(formatAuditValue(undefined)).toBe("—");
    expect(formatAuditValue("")).toBe("—");
    expect(formatAuditValue("   ")).toBe("—");
  });

  it("переводит булево значение", () => {
    expect(formatAuditValue(true)).toBe("да");
    expect(formatAuditValue(false)).toBe("нет");
  });

  it("возвращает строку и число как есть", () => {
    expect(formatAuditValue("Гидронасос")).toBe("Гидронасос");
    expect(formatAuditValue(42)).toBe("42");
  });

  it("объединяет непустой массив через запятую", () => {
    expect(formatAuditValue(["daf", "man"])).toBe("daf, man");
    expect(formatAuditValue([])).toBe("—");
  });
});
