/**
 * Настройки браузерного Sentry, вынесенные отдельно от `Sentry.init`.
 *
 * Так тест может поднять клиент ровно с этими опциями на собственном
 * in-memory transport и проверить и захват ошибок, и отсутствие BrowserTracing,
 * не вызывая при этом побочный `init` из `src/instrumentation-client.ts` и
 * не отправляя ни одной искусственной ошибки в настоящий Sentry.
 *
 * Браузерная часть работает в режиме «только ошибки». Трассировка в браузере
 * стоит заметной работы главного потока на первом экране (перехват fetch/XHR
 * и history, наблюдатели web-vitals), а пользы этому каталогу не даёт:
 * серверные транзакции остаются включёнными в `src/instrumentation.ts`, и
 * именно они показывают, где действительно тратится время. Поэтому здесь
 * нет клиентского `tracesSampleRate`, а BrowserTracing убирается из набора
 * интеграций по умолчанию поддержанным колбэком `integrations`. По той же
 * причине из instrumentation-client снят экспорт `onRouterTransitionStart`:
 * он нужен исключительно для навигационных span-ов, которых больше нет.
 */
export const BROWSER_TRACING_INTEGRATION_NAME = "BrowserTracing";

export const browserSentryOptions = {
  // NEXT_PUBLIC_SENTRY_DSN unset makes init a no-op — safe before a Sentry
  // project exists. No Session Replay: this catalog collects no user accounts
  // or checkout data, but replay still records real visitor screens, which is
  // more than this project needs.
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
  // Generic вместо импорта типа Integration из внутреннего пакета Sentry:
  // фильтру нужно только имя интеграции, а возвращаемый тип совпадает с
  // входным, поэтому колбэк подходит под сигнатуру `Sentry.init`.
  integrations: <T extends { name: string }>(defaultIntegrations: T[]): T[] =>
    defaultIntegrations.filter((integration) => integration.name !== BROWSER_TRACING_INTEGRATION_NAME),
};
