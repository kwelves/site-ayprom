export interface ProductHotspotAssignmentUpdate {
  hotspotId: string;
  expectedProductId: string | null;
  productId: string | null;
}

export type ProductHotspotAssignmentActionState =
  | { error: string; success?: never; savedUpdates?: never }
  | { success: true; savedUpdates: ProductHotspotAssignmentUpdate[]; error?: never }
  | null;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPDATE_KEYS = ["expectedProductId", "hotspotId", "productId"];
const CONFLICT_MESSAGE = "Данные хотспотов изменены другим администратором. Обновите страницу и повторите действие.";
const RPC_CONFLICT_ERRORS = new Set([
  "Hotspot assignment state has changed",
  "A selected product is already assigned to another hotspot",
  "Every selected hotspot must exist",
]);

export function getProductHotspotAssignmentRpcErrorMessage(message: string): string | null {
  if (RPC_CONFLICT_ERRORS.has(message)) return CONFLICT_MESSAGE;
  if (message === "Every selected product must be published") {
    return "Закрепить можно только существующий опубликованный товар.";
  }
  if (message === "A product may be assigned to only one hotspot") {
    return "Один товар нельзя закрепить за несколькими хотспотами.";
  }
  return null;
}

function parseNullableUuid(value: unknown, fieldLabel: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${fieldLabel} имеет неверный формат.`);
  }
  return value;
}

export function parseProductHotspotAssignmentUpdates(value: unknown): ProductHotspotAssignmentUpdate[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    throw new Error("Нужно передать одно или два изменения хотспотов.");
  }

  const updates = value.map((entry): ProductHotspotAssignmentUpdate => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("Одна из строк хотспота имеет неверный формат.");
    }

    const record = entry as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length !== UPDATE_KEYS.length || keys.some((key, index) => key !== UPDATE_KEYS[index])) {
      throw new Error("Строка хотспота содержит неверный набор полей.");
    }

    const hotspotId = parseNullableUuid(record.hotspotId, "Идентификатор хотспота");
    if (hotspotId === null) throw new Error("Идентификатор хотспота обязателен.");

    return {
      hotspotId,
      expectedProductId: parseNullableUuid(record.expectedProductId, "Ожидаемый товар"),
      productId: parseNullableUuid(record.productId, "Новый товар"),
    };
  });

  if (new Set(updates.map((update) => update.hotspotId)).size !== updates.length) {
    throw new Error("Один и тот же хотспот передан несколько раз.");
  }

  return updates;
}
