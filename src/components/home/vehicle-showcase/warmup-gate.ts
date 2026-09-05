/**
 * Условие фонового прогрева фотографий техники.
 *
 * Раньше оно было выражением внутри JSX и содержало ошибку: `(!entered ||
 * revealed)` разрешало очередь ровно тогда, когда секция ещё НЕ входила в
 * экран, из-за чего все пять фотографий уезжали в первую загрузку главной.
 * Вынесено в отдельную чистую функцию, чтобы условие было видно целиком и
 * проверялось тестом, а не читалось по диагонали в разметке.
 */
export interface VehicleWarmupConditions {
  /** Секция хотя бы раз входила в область просмотра. */
  entered: boolean;
  /** Хореография появления сцены закончилась. */
  revealed: boolean;
  /** Фотография техники по умолчанию уже загружена. */
  initialVehicleReady: boolean;
  /** Первая сцена улеглась: hero проявлен, переходов нет. */
  firstViewSettled: boolean;
  /** Идёт ли прямо сейчас переключение техники. */
  transitionPhase: string;
  /** Секция видима СЕЙЧАС, а не «когда-то была видима». */
  sectionVisible: boolean;
}

export function isVehicleWarmupAllowed(conditions: VehicleWarmupConditions): boolean {
  return (
    conditions.entered &&
    conditions.revealed &&
    conditions.initialVehicleReady &&
    conditions.firstViewSettled &&
    conditions.transitionPhase === "idle" &&
    conditions.sectionVisible
  );
}
