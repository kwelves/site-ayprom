// Визуальный масштаб — множитель `transform: scale()` для логотипа бренда или
// фотографии товара. `null` означает «без масштабирования» и остаётся
// допустимым значением.
//
// Границы измерены по фактическим данным каталога, а не назначены на глаз: все
// заполненные значения лежали в 0.75–1.6, поэтому 0.1–5.0 даёт более чем
// трёхкратный запас сверху и одновременно отсекает ноль, отрицательные значения
// и порядковые опечатки вида «100» вместо «1.00». Те же границы закреплены
// CHECK-констрейнтами в БД (20260825090000_visual_scale_bounds.sql): UI даёт
// подсказку, сервер отвергает, БД гарантирует.
const MIN_VISUAL_SCALE = 0.1;
const MAX_VISUAL_SCALE = 5;
const VISUAL_SCALE_STEP = 0.05;

// Хранение округляется до сотых: шаг ввода — 0.05, а различия мельче сотой
// незаметны визуально и только создают расхождение между тем, что админ ввёл,
// и тем, что записано.
const VISUAL_SCALE_DECIMALS = 2;

/**
 * Приводит введённый масштаб к допустимому виду или отвергает его.
 *
 * Пустое значение трактуется как «без масштабирования» и даёт `null`. Значение
 * вне диапазона намеренно отвергается, а не обрезается до границы: молча
 * сохранённая «1.00» вместо введённой «100» скрыла бы от админа собственную
 * опечатку.
 */
export function normalizeVisualScale(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;

  const value = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value)) {
    throw new Error("Масштаб должен быть числом.");
  }
  if (value < MIN_VISUAL_SCALE || value > MAX_VISUAL_SCALE) {
    throw new Error(`Масштаб должен быть от ${MIN_VISUAL_SCALE} до ${MAX_VISUAL_SCALE}.`);
  }

  return Number(value.toFixed(VISUAL_SCALE_DECIMALS));
}

export { MIN_VISUAL_SCALE, MAX_VISUAL_SCALE, VISUAL_SCALE_STEP };
