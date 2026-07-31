import * as Sentry from "@sentry/nextjs";

// SENTRY_DSN unset (e.g. no Sentry project created yet) makes Sentry.init a
// no-op — this file is safe to ship even before a real DSN exists.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
