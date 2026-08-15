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
