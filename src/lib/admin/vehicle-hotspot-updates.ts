export const HOTSPOTS_PER_VEHICLE = 5;

export interface VehicleHotspotUpdate {
  id: string;
  label: string;
  productId: string | null;
}

// This state is intentionally separate from FormActionState: existing admin
// forms still use their established `null | { error }` contract, while the
// showcase editor needs a positive acknowledgement before it offers Undo.
export type VehicleHotspotActionState =
  | { error: string; success?: never; savedUpdates?: never }
  | { success: true; savedUpdates: VehicleHotspotUpdate[]; error?: never }
  | null;

export function parseVehicleHotspotUpdates(value: unknown): VehicleHotspotUpdate[] {
  if (!Array.isArray(value) || value.length !== HOTSPOTS_PER_VEHICLE) {
    throw new Error(`Нужно сохранить ровно ${HOTSPOTS_PER_VEHICLE} хотспотов.`);
  }

  const updates = value.map((entry): VehicleHotspotUpdate => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("Одна из строк хотспота имеет неверный формат.");
    }
    const { id, label, productId } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !id || typeof label !== "string") {
      throw new Error("У каждого хотспота должны быть идентификатор и название.");
    }
    if (productId !== null && (typeof productId !== "string" || !productId)) {
      throw new Error("Товар хотспота имеет неверный формат.");
    }

    const normalizedLabel = label.trim();
    if (!normalizedLabel) {
      throw new Error("Заполните названия всех хотспотов.");
    }
    return { id, label: normalizedLabel, productId };
  });

  if (new Set(updates.map((update) => update.id)).size !== updates.length) {
    throw new Error("Один и тот же хотспот передан несколько раз.");
  }
  const productIds = updates.flatMap((update) => (update.productId ? [update.productId] : []));
  if (new Set(productIds).size !== productIds.length) {
    throw new Error("Один товар нельзя закрепить за несколькими хотспотами.");
  }
  return updates;
}

// `priorUpdates` travels from a Client Component when Undo is pressed, so it
// must be parsed and validated just as strictly as an ordinary form payload.
export function parseSerializedVehicleHotspotUpdates(serialized: unknown): VehicleHotspotUpdate[] {
  if (typeof serialized !== "string") {
    throw new Error("Не удалось прочитать изменения хотспотов.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Изменения хотспотов имеют неверный формат.");
  }
  return parseVehicleHotspotUpdates(parsed);
}

// Server Actions transport structured-clone values over the wire. Accepting
// the decoded array keeps the direct Undo call ergonomic, but it is still
// passed through the exact same validation as a JSON string from a form.
export function parseVehicleHotspotUndoUpdates(value: unknown): VehicleHotspotUpdate[] {
  return typeof value === "string" ? parseSerializedVehicleHotspotUpdates(value) : parseVehicleHotspotUpdates(value);
}
