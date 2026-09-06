import * as Sentry from "@sentry/nextjs";
import { browserSentryOptions } from "@/lib/sentry-browser-options";

// Режим «только ошибки»: почему трассировка в браузере отключена и что при
// этом сохраняется — см. комментарий в src/lib/sentry-browser-options.ts.
Sentry.init(browserSentryOptions);

// Next.js вызывает этот обязательный для Sentry SDK хук при навигации.
// BrowserTracing ниже отключён настройками, поэтому без её обработчика экспорт
// не создаёт клиентские span-ы и сохраняет режим «только ошибки».
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
