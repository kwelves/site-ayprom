import * as Sentry from "@sentry/nextjs";
import { browserSentryOptions } from "@/lib/sentry-browser-options";

// Режим «только ошибки»: почему трассировка в браузере отключена и что при
// этом сохраняется — см. комментарий в src/lib/sentry-browser-options.ts.
Sentry.init(browserSentryOptions);
