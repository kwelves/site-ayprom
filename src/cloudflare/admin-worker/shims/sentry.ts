// Stand-in for `@sentry/nextjs` in the admin Worker. The class of every error is logged (messages can hold personal
// data); when a Sentry address is configured (configureSentry), the error is also sent there from the background.
import { runInBackground } from "@/lib/background-tasks";
import { createSentryReporter, type SentryReporter } from "@/lib/error-reporting/sentry-lite";

interface SentryEnv {
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_RELEASE?: string;
}

let reporter: SentryReporter | null = null;
let configuredWith = "";

/** Called at the start of every request and cron run; the reporter (and its flood protection) lives as long as the isolate. */
export function configureSentry(env: SentryEnv, fetchImpl?: typeof fetch): void {
  const signature = `${env.SENTRY_DSN ?? ""}|${env.SENTRY_ENVIRONMENT ?? ""}|${env.SENTRY_RELEASE ?? ""}`;
  if (signature === configuredWith && !fetchImpl) return;
  configuredWith = signature;
  reporter = createSentryReporter({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT || "production",
    release: env.SENTRY_RELEASE || undefined,
    runtime: "cloudflare-admin-worker",
    fetchImpl,
  });
}

export function init(...args: unknown[]): void { void args; }

export function captureException(error: unknown, hint?: { tags?: Record<string, unknown> }): string {
  console.error(`[admin] captured_exception ${error instanceof Error ? error.name : typeof error}`);
  if (reporter) runInBackground(reporter(error, hint?.tags));
  return "";
}

export function captureMessage(message: string): string {
  console.error(`[admin] captured_message ${message.slice(0, 120)}`);
  return "";
}
