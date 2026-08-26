// Ошибки PostgREST в рантайме не являются экземплярами Error, хотя в типах
// объявлены наследником: проверка `error instanceof Error` для них ложна.
// Поэтому общий getErrorMessage вернул бы для любой ошибки RPC общий текст, и
// конфликт версий выглядел бы для администратора как «не удалось сохранить» без
// объяснения причины.
//
// Здесь разделены два случая. Сообщения, которые продуктовые RPC формируют
// намеренно, написаны для администратора по-русски и передаются дословно. Всё
// остальное намеренно скрывается за общим текстом, чтобы в интерфейс не утекали
// имена констрейнтов и прочие детали схемы; подробности уходят в серверный
// журнал.

export interface ProductRpcErrorLike {
  code?: string;
  message?: string;
  details?: string;
}

/** Коды, которыми продуктовые RPC сообщают о заведомо ожидаемых ситуациях. */
const INTENTIONAL_CODES = new Set([
  "22023", // проверка входа: пустое имя, неизвестная ссылка, дубликат
  "55000", // конфликт версий: товар изменён другим администратором
]);

export const PRODUCT_RPC_FALLBACK_MESSAGE =
  "Не удалось сохранить товар. Подробности записаны в журнал сервера.";

export function isIntentionalProductRpcError(error: ProductRpcErrorLike): boolean {
  return Boolean(error.code && INTENTIONAL_CODES.has(error.code) && error.message);
}

/**
 * Превращает ошибку RPC в настоящий Error, пригодный для показа админу.
 *
 * `onUnexpected` вызывается только для неожиданных ошибок — туда передаются
 * подробности для журнала, которые не попадают в интерфейс.
 */
export function toProductRpcError(
  error: ProductRpcErrorLike,
  onUnexpected?: (details: ProductRpcErrorLike) => void,
): Error {
  if (isIntentionalProductRpcError(error)) {
    return new Error(error.message);
  }
  onUnexpected?.({ code: error.code, message: error.message, details: error.details });
  return new Error(PRODUCT_RPC_FALLBACK_MESSAGE);
}
