import { describe, expect, it } from "vitest";
import { auditActionLabel, auditEntityLabel, auditChangedFieldsLabel } from "@/lib/admin/audit-labels";

describe("auditEntityLabel", () => {
  it("переводит имя таблицы в термин админки", () => {
    expect(auditEntityLabel("product_characteristics")).toBe("Характеристики");
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
