// Отдельно от queries.ts, как и pagination.ts: тот модуль начинается с
// `import "server-only"` и тянет service-role клиент, а эти подписи нужны
// клиентским компонентам и тестам.

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  INSERT: "Создание",
  UPDATE: "Изменение",
  DELETE: "Удаление",
};

// Имена таблиц из триггеров аудита переводятся в термины админки. Список
// покрывает все таблицы, на которые навешаны триггеры в миграции
// admin_audit_log; незнакомое имя показывается как есть, а не прячется.
export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  products: "Товары",
  product_images: "Фото товаров",
  product_characteristics: "Характеристики",
  product_brands: "Бренды товаров",
  product_vehicle_types: "Типы техники товаров",
  categories: "Категории",
  subcategories: "Подкатегории",
  brands: "Бренды",
  category_brands: "Бренды категорий",
  vehicle_types: "Типы техники",
  vehicle_hotspots: "Хотспоты спецтехники",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export function auditEntityLabel(entityType: string): string {
  return AUDIT_ENTITY_LABELS[entityType] ?? entityType;
}

// Триггер пишет 'created'/'deleted' вместо списка колонок для вставки и
// удаления — там перечислять нечего. Для изменения приходит реальный список
// изменившихся полей.
export function auditChangedFieldsLabel(action: string, changedFields: string[]): string {
  if (action === "INSERT") return "запись создана";
  if (action === "DELETE") return "запись удалена";
  if (changedFields.length === 0) return "без изменений полей";
  return changedFields.join(", ");
}

export interface AuditFieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}

// Value-level diff for the expandable detail — null when there's nothing to
// show beyond the plain field-name list (pre-migration rows have no
// old_values/new_values, and a record with no changed fields has nothing to
// expand either).
export function auditFieldDiffs(entry: {
  action: string;
  changedFields: string[];
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}): AuditFieldDiff[] | null {
  const { action, changedFields, oldValues, newValues } = entry;
  if (!oldValues && !newValues) return null;

  if (action === "INSERT") {
    const keys = Object.keys(newValues ?? {}).sort();
    if (keys.length === 0) return null;
    return keys.map((field) => ({ field, before: null, after: newValues?.[field] ?? null }));
  }
  if (action === "DELETE") {
    const keys = Object.keys(oldValues ?? {}).sort();
    if (keys.length === 0) return null;
    return keys.map((field) => ({ field, before: oldValues?.[field] ?? null, after: null }));
  }
  if (changedFields.length === 0) return null;
  return changedFields.map((field) => ({
    field,
    before: oldValues?.[field] ?? null,
    after: newValues?.[field] ?? null,
  }));
}

// Renders one diff value for display — covers the shapes jsonb columns
// actually carry (primitives, arrays of strings for e.g. compatibleBrands
// style join rows would need their own table, not this generic one).
export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (typeof value === "string") return value.trim() === "" ? "—" : value;
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.map(formatAuditValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
