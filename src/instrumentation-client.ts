import * as Sentry from "@sentry/nextjs";

// NEXT_PUBLIC_SENTRY_DSN unset makes this a no-op — safe before a Sentry
// project exists. No Session Replay: this catalog collects no user accounts
// or checkout data, but replay still records real visitor screens, which is
// more than this project needs.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
